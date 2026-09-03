# Assistant KB Slice 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can attach local documents to an assistant, get grounded Q&A and draft review from them, and create artifacts through the Template Gallery with the KB supplying substance.

**Architecture:** Generalize the shipped project-KB service from `projectId` to an owner scope. Project stores keep their existing flat path; assistant stores live under a **sibling root** keyed by a hashed owner key. Folder-touching operations take a `KnowledgeTarget` (project targets carry the renderer-owned workspace; assistant paths are derived in main). Assistant scope gets its own session-MCP identity, its own search tool, and a bounded whole-document read tool. Citations carry `{scope, sourceId, fileName, anchor}` end to end and resolve from frozen session descriptors.

**Tech Stack:** Electron main + React renderer, TypeScript (strict, `strictNullChecks` off), Vitest 4, Arco Design, UnoCSS semantic tokens, i18next.

**Design of record:** `docs/design/assistant-knowledge-base-design.md` — Slice 1 section. The five entry criteria there are non-negotiable; each maps to tasks below.

## Merge units

Three units, sequential, each independently reviewable and mergeable:

| Unit | Tasks | Produces |
| --- | --- | --- |
| **A — Service and contracts** | 0–6 | Scope-aware KB service, storage roots, manifest V1/V2, transactional binding, lifecycle states. No user-visible change. |
| **B — Retrieval, tools, citations** | 7–11 | Working assistant-scope retrieval: search + bounded read, scope-carrying citations, attach path. |
| **C — UI and lifecycle** | 12–17 | The user-facing feature: shared components, KnowledgeSection, scope-aware citation routing, watcher ownership. |

Do not start C before B is merged; C's citation routing depends on B's carrier.

## Entry-criteria map

| Criterion | Tasks |
| --- | --- |
| 1. Folder ops take `KnowledgeTarget` | 1, 4 |
| 2. Persisted lifecycle states + per-unit generation checks + transactional binding | 5, 6 |
| 3. `{scope, sourceId, fileName, anchor}` carrier + read tool; ambiguous prose unlinked | 9, 10, 15 |
| 4. `components/knowledge/` + `hooks/knowledge/` with slots freed | 12, 13 |
| 5. Locked owner key; doubly-gated V1 manifest; frozen-descriptor resolution | 2, 3, 15 |

---

# Unit A — Service and contracts

### Task 0: Branch and green baseline

- [ ] **Step 1: Branch from a fresh base**

```bash
git fetch origin && git checkout -b feat/assistant-kb-unit-a origin/sprint2
bun install
```

- [ ] **Step 2: Verify the baseline is green and record directory counts**

```bash
bun run test 2>&1 | tail -5
for d in packages/desktop/src/renderer/components packages/desktop/src/renderer/hooks packages/desktop/src/renderer/pages/project/components packages/desktop/src/renderer/pages/settings/AssistantSettings/editor; do echo "$d: $(ls $d | wc -l)"; done
```

Expected: tests pass. Counts should read 10 / 10 / 10 / 6. A red baseline in a fresh tree usually means stale `node_modules` — re-run `bun install` before believing failures. If counts differ, apply the same "not worse" ratchet logic to the real numbers in Task 12.

- [ ] **Step 3: Confirm the store root helper names**

```bash
grep -rn "getProjectKbRootDir" packages/desktop/src --include="*.ts" | head -3
```

Expected: a helper used by `projectKnowledgeBridge.ts`. Note its module — Task 2 adds a sibling there.

---

### Task 1: Scope, target, and citation types

**Files:**
- Modify: `packages/desktop/src/common/knowledge/types.ts`
- Create: `packages/desktop/src/common/knowledge/scope.ts`
- Create: `packages/desktop/src/common/knowledge/scope.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { isAssistantScope, isProjectScope, scopeKey, workspaceOf } from './scope';

describe('scope helpers', () => {
  it('narrows project and assistant scopes', () => {
    expect(isProjectScope({ kind: 'project', id: 'p1' })).toBe(true);
    expect(isAssistantScope({ kind: 'assistant', id: 'a1' })).toBe(true);
    expect(isProjectScope({ kind: 'assistant', id: 'a1' })).toBe(false);
  });

  it('builds a composite key so a project and assistant sharing an id never collide', () => {
    expect(scopeKey({ kind: 'project', id: 'x' })).toBe('project:x');
    expect(scopeKey({ kind: 'assistant', id: 'x' })).toBe('assistant:x');
    expect(scopeKey({ kind: 'project', id: 'x' })).not.toBe(scopeKey({ kind: 'assistant', id: 'x' }));
  });

  it('returns the workspace only for project targets', () => {
    expect(workspaceOf({ scope: { kind: 'project', id: 'p1' }, workspace: '/ws' })).toBe('/ws');
    expect(workspaceOf({ scope: { kind: 'assistant', id: 'a1' } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run packages/desktop/src/common/knowledge/scope.test.ts`
Expected: FAIL — cannot resolve `./scope`.

- [ ] **Step 3: Implement**

`scope.ts`:

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Who owns a knowledge store. Identity only — carries no filesystem location. */
export type KnowledgeScope = { kind: 'project'; id: string } | { kind: 'assistant'; id: string };

/**
 * A scope plus everything needed to resolve its source folder. Project folders live
 * inside a renderer-owned workspace; assistant folders are derived in main, so an
 * assistant target carries no path and must never accept one.
 */
export type KnowledgeTarget =
  | { scope: { kind: 'project'; id: string }; workspace: string }
  | { scope: { kind: 'assistant'; id: string } };

export const isProjectScope = (scope: KnowledgeScope): scope is { kind: 'project'; id: string } =>
  scope.kind === 'project';

export const isAssistantScope = (scope: KnowledgeScope): scope is { kind: 'assistant'; id: string } =>
  scope.kind === 'assistant';

/** Composite key for queues, maps and events. Never key on `id` alone. */
export const scopeKey = (scope: KnowledgeScope): string => `${scope.kind}:${scope.id}`;

export const workspaceOf = (target: KnowledgeTarget): string | null =>
  'workspace' in target ? target.workspace : null;
```

Append to `types.ts`:

```typescript
/** Manifest as shipped today: project-only, version 1. */
export type KnowledgeManifestV1 = KnowledgeManifest & { schemaVersion: 1; projectId: string };

/** Scope-aware manifest. Same fields otherwise. */
export type KnowledgeManifestV2 = Omit<KnowledgeManifest, 'schemaVersion' | 'projectId'> & {
  schemaVersion: 2;
  scope: KnowledgeScope;
};

export type KnowledgeCitationTarget = {
  scope: KnowledgeScope;
  sourceId: string;
  fileName: string;
  anchor?: string;
};
```

Import `KnowledgeScope` into `types.ts` from `./scope`.

- [ ] **Step 4: Run to verify it passes**

```bash
bunx vitest run packages/desktop/src/common/knowledge/scope.test.ts
bunx tsc --noEmit
```

Expected: 3 passed, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/common/knowledge/
git commit -m "feat(knowledge): scope, target and citation-target contracts"
```

---

### Task 2: Owner key and assistant store root

**Files:**
- Create: `packages/desktop/src/common/knowledge/ownerKey.ts`
- Create: `packages/desktop/src/common/knowledge/ownerKey.test.ts`
- Modify: the module exporting `getProjectKbRootDir` (found in Task 0 Step 3)

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { OWNER_KEY_VERSION, safeOwnerKey } from './ownerKey';

describe('safeOwnerKey', () => {
  it('is a stable 64-char lowercase hex digest', () => {
    const key = safeOwnerKey({ kind: 'assistant', id: 'word-creator' });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(safeOwnerKey({ kind: 'assistant', id: 'word-creator' })).toBe(key);
  });

  it('separates kinds so a project and assistant with one id differ', () => {
    expect(safeOwnerKey({ kind: 'assistant', id: 'x' })).not.toBe(safeOwnerKey({ kind: 'project', id: 'x' }));
  });

  it('is injective for the NUL-boundary ambush', () => {
    // Without the NUL separator, 'assistant' + 'a\0b' and 'assistant\0a' + 'b' would collide.
    expect(safeOwnerKey({ kind: 'assistant', id: 'a b' })).not.toBe(
      safeOwnerKey({ kind: 'assistant', id: 'ab' })
    );
  });

  it('maps case-differing, unicode, separator-bearing and long ids to distinct keys', () => {
    const ids = ['Abc', 'abc', 'Ãºnico', 'a/b', 'a\\b', '..', 'x'.repeat(500)];
    const keys = ids.map((id) => safeOwnerKey({ kind: 'assistant', id }));
    expect(new Set(keys).size).toBe(ids.length);
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('exposes a version so a future algorithm change can migrate', () => {
    expect(OWNER_KEY_VERSION).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run packages/desktop/src/common/knowledge/ownerKey.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import type { KnowledgeScope } from './scope';

/**
 * Algorithm version. Bump only alongside a migration: the key names store
 * directories on disk, so a silent change would orphan every existing store.
 */
export const OWNER_KEY_VERSION = 1;

/**
 * Filesystem-safe store directory name for a scope: SHA-256 over the exact UTF-8
 * bytes of `kind + NUL + id`, hex-encoded. Ids arrive from an HTTP API and are
 * opaque — never treat one as a path segment. The NUL separator keeps the
 * concatenation injective.
 */
export const safeOwnerKey = (scope: KnowledgeScope): string =>
  createHash('sha256').update(Buffer.from(`${scope.kind} ${scope.id}`, 'utf8')).digest('hex');
```

In the module exporting `getProjectKbRootDir`, add its sibling next to it (mirror the existing implementation's base-directory choice exactly, changing only the final segment):

```typescript
export const getAssistantKbRootDir = (): string => /* same base as getProjectKbRootDir */ '';
```

Replace the placeholder body with the same expression `getProjectKbRootDir` uses, substituting the leaf directory name `assistant-kb`. Read that function before editing so the base directory matches; do not invent a new base.

- [ ] **Step 4: Run to verify it passes**

```bash
bunx vitest run packages/desktop/src/common/knowledge/ownerKey.test.ts
bunx tsc --noEmit
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/common/knowledge/ownerKey.* packages/desktop/src/process/
git commit -m "feat(knowledge): versioned owner key and assistant store root"
```

---

### Task 3: Manifest V1/V2 normalization

**Files:**
- Create: `packages/desktop/src/common/knowledge/manifestCompat.ts`
- Create: `packages/desktop/src/common/knowledge/manifestCompat.test.ts`
- Modify: `packages/desktop/src/common/knowledge/searchCore.ts` (version gate at line ~31)

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { normalizeManifest } from './manifestCompat';

const v1 = { schemaVersion: 1, projectId: 'p1', sources: [] };
const v2 = { schemaVersion: 2, scope: { kind: 'assistant', id: 'a1' }, sources: [] };

describe('normalizeManifest', () => {
  it('loads a V1 manifest for the matching project scope', () => {
    const result = normalizeManifest(v1, { kind: 'project', id: 'p1' });
    expect(result?.scope).toEqual({ kind: 'project', id: 'p1' });
    expect(result?.schemaVersion).toBe(2);
  });

  it('rejects a V1 manifest whose projectId does not match the expected scope', () => {
    expect(normalizeManifest(v1, { kind: 'project', id: 'other' })).toBeNull();
  });

  it('rejects a V1 manifest when assistant scope is expected', () => {
    expect(normalizeManifest(v1, { kind: 'assistant', id: 'p1' })).toBeNull();
  });

  it('loads a V2 manifest whose scope matches', () => {
    expect(normalizeManifest(v2, { kind: 'assistant', id: 'a1' })?.scope).toEqual({
      kind: 'assistant',
      id: 'a1',
    });
  });

  it('fails closed on V2 scope mismatch, unknown versions and malformed input', () => {
    expect(normalizeManifest(v2, { kind: 'assistant', id: 'other' })).toBeNull();
    expect(normalizeManifest(v2, { kind: 'project', id: 'a1' })).toBeNull();
    expect(normalizeManifest({ schemaVersion: 3 }, { kind: 'project', id: 'p1' })).toBeNull();
    expect(normalizeManifest(null, { kind: 'project', id: 'p1' })).toBeNull();
    expect(normalizeManifest({ schemaVersion: 1 }, { kind: 'project', id: 'p1' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run packages/desktop/src/common/knowledge/manifestCompat.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { KnowledgeManifestV2 } from './types';
import type { KnowledgeScope } from './scope';

/**
 * Reads either manifest generation and returns the V2 shape, or null to fail
 * closed. A V1 manifest is project-only by construction, so it loads ONLY when
 * project scope is expected AND its recorded projectId matches. Normalizing in
 * memory means no file moves, no BM25 rebuild and no repeated embedding calls.
 */
export function normalizeManifest(raw: unknown, expected: KnowledgeScope): KnowledgeManifestV2 | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;

  if (m.schemaVersion === 1) {
    if (expected.kind !== 'project') return null;
    if (typeof m.projectId !== 'string' || m.projectId !== expected.id) return null;
    const { projectId: _projectId, schemaVersion: _schemaVersion, ...rest } = m;
    return { ...rest, schemaVersion: 2, scope: { kind: 'project', id: expected.id } } as KnowledgeManifestV2;
  }

  if (m.schemaVersion === 2) {
    const scope = m.scope as KnowledgeScope | undefined;
    if (!scope || typeof scope !== 'object') return null;
    if (scope.kind !== expected.kind || scope.id !== expected.id) return null;
    return m as unknown as KnowledgeManifestV2;
  }

  return null; // unknown or missing version
}
```

In `searchCore.ts`, replace the `manifest.schemaVersion !== 1` gate with a `normalizeManifest(manifest, expectedScope)` call, threading the expected scope in from the caller's env (Task 8 supplies `scopeKind`/`scopeId` to the subprocess). Reject when it returns null, with the same "no vectors / treat as empty" behavior the current guard produces.

- [ ] **Step 4: Run to verify it passes**

```bash
bunx vitest run packages/desktop/src/common/knowledge/
bunx tsc --noEmit
```

Expected: all knowledge tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/common/knowledge/
git commit -m "feat(knowledge): manifest V1 to V2 normalization with fail-closed scope gating"
```

---

### Task 4: Generalize the service to scope and target

**Files:**
- Modify: `packages/desktop/src/process/services/projectKnowledge/projectKnowledgeService.ts`
- Modify: `packages/desktop/src/process/services/projectKnowledge/*.test.ts` (existing suites)
- Modify: `packages/desktop/src/process/bridge/projectKnowledgeBridge.ts`
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts`
- Modify: `packages/desktop/src/common/adapter/native/payloadSchemas.ts`

- [ ] **Step 1: Write the failing tests** (append to the service's existing test file)

```typescript
describe('scope generalization', () => {
  it('keeps project stores at their existing flat path', () => {
    // Guards the compat decision: nesting project stores would orphan every shipped index.
    expect(resolveStoreDir({ kind: 'project', id: 'p1' })).toBe(path.join(projectRoot, 'p1'));
  });

  it('places assistant stores under the assistant root by owner key', () => {
    const dir = resolveStoreDir({ kind: 'assistant', id: 'word-creator' });
    expect(dir.startsWith(assistantRoot + path.sep)).toBe(true);
    expect(path.basename(dir)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('serializes per composite scope key, not per id', async () => {
    const order: string[] = [];
    const slow = enqueueFor({ kind: 'project', id: 'x' }, async () => { await tick(); order.push('project'); });
    const fast = enqueueFor({ kind: 'assistant', id: 'x' }, async () => { order.push('assistant'); });
    await Promise.all([slow, fast]);
    // Different scopes run in parallel: the fast assistant job finishes first.
    expect(order[0]).toBe('assistant');
  });

  it('rejects a folder operation on a project target with no workspace', async () => {
    await expect(
      service.syncFolder({ scope: { kind: 'project', id: 'p1' } } as never)
    ).rejects.toThrow(/workspace/i);
  });

  it('derives the assistant folder in main and ignores any supplied path', async () => {
    const target = { scope: { kind: 'assistant', id: 'a1' }, workspace: '/attacker' } as never;
    await expect(service.syncFolder(target)).resolves.not.toThrow();
    expect(scanCalls.at(-1)).not.toContain('/attacker');
  });
});
```

Adapt the helper names (`resolveStoreDir`, `enqueueFor`, `projectRoot`, `assistantRoot`, `scanCalls`) to whatever the existing suite already exposes or fixtures; do not add new exports purely for tests if the suite has an injection seam.

- [ ] **Step 2: Run to verify failure**

Run: `bunx vitest run packages/desktop/src/process/services/projectKnowledge/`
Expected: FAIL — the service still takes `projectId`.

- [ ] **Step 3: Implement**

In `projectKnowledgeService.ts`:

```typescript
  const storeDirOf = (scope: KnowledgeScope): string => {
    const root = path.resolve(scope.kind === 'project' ? deps.storeRootDir : deps.assistantStoreRootDir);
    // Project stores keep their historical flat layout; changing it would orphan
    // every shipped index. Assistant stores are named by hashed owner key.
    const leaf = scope.kind === 'project' ? scope.id : safeOwnerKey(scope);
    const target = path.resolve(root, leaf);
    if (!target.startsWith(root + path.sep)) throw new Error(`Invalid knowledge scope: ${scopeKey(scope)}`);
    return target;
  };

  const knowledgeDirOf = (target: KnowledgeTarget): string => {
    if (target.scope.kind === 'project') {
      const workspace = workspaceOf(target);
      if (!workspace) throw new Error('project knowledge target requires a workspace');
      return path.join(workspace, KNOWLEDGE_FOLDER_NAME);
    }
    // Derived in main from the owner key — never from caller input.
    return path.join(deps.assistantDocsRootDir, safeOwnerKey(target.scope), KNOWLEDGE_FOLDER_NAME);
  };
```

Change `queues` to key on `scopeKey(scope)`. Change every public method signature: store-only operations (`listSources`, `getSourceText`, `removeStore`, `getSessionMcpServer`) take `KnowledgeScope`; folder operations (`addSources`, `removeSource`, `retrySource`, `syncFolder`) take `KnowledgeTarget`. Thread the scope into manifest reads so Task 3's `normalizeManifest` receives the expected scope.

In `payloadSchemas.ts`, add a scope schema and a target schema, replacing the `projectId`-shaped ones:

```typescript
const knowledgeScopeSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('project'), id: safeIdSchema }).strict(),
    z.object({ kind: z.literal('assistant'), id: z.string().min(1).max(256) }).strict(),
  ]);

const knowledgeTargetSchema = z.union([
  z.object({ scope: z.object({ kind: z.literal('project'), id: safeIdSchema }).strict(), workspace: pathSchema }).strict(),
  z.object({ scope: z.object({ kind: z.literal('assistant'), id: z.string().min(1).max(256) }).strict() }).strict(),
]);
```

The assistant branch of `knowledgeTargetSchema` is `.strict()` with no `workspace` key, so a renderer-supplied assistant path is rejected at the boundary rather than defensively ignored. Assistant ids are not constrained to `safeIdSchema` because they are opaque API values — the owner key makes them path-safe.

Update `ipcBridge.ts` `projectKnowledge.*` provider payloads to `{ scope }` / `{ target }` accordingly, and `projectKnowledgeBridge.ts` to pass them through.

- [ ] **Step 4: Run to verify it passes**

```bash
bunx vitest run packages/desktop/src/process/services/projectKnowledge/
bunx tsc --noEmit
```

Expected: all pass, including the pre-existing project cases (they are the regression net).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/process/ packages/desktop/src/common/adapter/
git commit -m "feat(knowledge): key the service by owner scope and target"
```

---

### Task 5: Transactional binding and persisted lifecycle states

**Files:**
- Create: `packages/desktop/src/common/knowledge/assistantKbBinding.ts`
- Create: `packages/desktop/src/common/knowledge/assistantKbBinding.test.ts`
- Modify: `packages/desktop/src/common/config/configKeys.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};
const set = vi.fn(async (key: string, value: unknown) => {
  store[key] = value;
});
const get = vi.fn((key: string) => store[key]);

vi.mock('@/common/config/configService', () => ({ configService: { get, set } }));

const { readBindings, setBindingState, validateBindings } = await import('./assistantKbBinding');

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  set.mockClear();
  set.mockImplementation(async (key: string, value: unknown) => {
    store[key] = value;
  });
});

describe('assistant KB binding', () => {
  it('persists before reporting success and round-trips states', async () => {
    await setBindingState('a1', 'enabled');
    expect(readBindings().a1.state).toBe('enabled');
  });

  it('leaves the binding unchanged when persistence fails', async () => {
    await setBindingState('a1', 'enabled');
    set.mockRejectedValueOnce(new Error('backend down'));
    await expect(setBindingState('a1', 'disabled')).rejects.toThrow('backend down');
    // The failed write must not be observable anywhere.
    expect(readBindings().a1.state).toBe('enabled');
  });

  it('supports the full persisted state set', async () => {
    for (const state of ['enabled', 'disabled', 'cleanupPending', 'orphaned'] as const) {
      await setBindingState('a1', state);
      expect(readBindings().a1.state).toBe(state);
    }
  });

  it('fails corrupt or unknown entries disabled rather than throwing', () => {
    expect(validateBindings({ a1: { state: 'bogus' }, a2: 'nope', a3: { state: 'enabled' } })).toEqual({
      a3: { state: 'enabled' },
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run packages/desktop/src/common/knowledge/assistantKbBinding.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { configService } from '@/common/config/configService';

export type AssistantKbState = 'enabled' | 'disabled' | 'cleanupPending' | 'orphaned';
export type AssistantKbBindings = Record<string, { state: AssistantKbState }>;

const KEY = 'assistant.knowledge.bindings';
const STATES: ReadonlySet<string> = new Set(['enabled', 'disabled', 'cleanupPending', 'orphaned']);

/** Drops anything unrecognizable: an unreadable binding must fail disabled, never enabled. */
export function validateBindings(raw: unknown): AssistantKbBindings {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: AssistantKbBindings = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const state = (value as { state?: unknown }).state;
    if (typeof state === 'string' && STATES.has(state)) out[id] = { state: state as AssistantKbState };
  }
  return out;
}

export const readBindings = (): AssistantKbBindings => validateBindings(configService.get(KEY));

/**
 * Transactional write. `configService.set` updates its cache and notifies listeners
 * BEFORE awaiting persistence, so a failed PUT would otherwise leave the new value
 * observable — breaking "enable failure leaves the binding unchanged". Snapshot,
 * write, and restore the snapshot on failure.
 */
export async function setBindingState(assistantId: string, state: AssistantKbState): Promise<void> {
  const before = readBindings();
  const next: AssistantKbBindings = { ...before, [assistantId]: { state } };
  try {
    await configService.set(KEY, next);
  } catch (error) {
    await configService.set(KEY, before).catch(() => undefined);
    throw error;
  }
}

export async function removeBinding(assistantId: string): Promise<void> {
  const before = readBindings();
  const { [assistantId]: _removed, ...next } = before;
  try {
    await configService.set(KEY, next);
  } catch (error) {
    await configService.set(KEY, before).catch(() => undefined);
    throw error;
  }
}
```

Register `'assistant.knowledge.bindings'` in `configKeys.ts` following the file's existing conventions, typed as `AssistantKbBindings | undefined`.

- [ ] **Step 4: Run to verify it passes, then commit**

```bash
bunx vitest run packages/desktop/src/common/knowledge/assistantKbBinding.test.ts
git add packages/desktop/src/common/knowledge/assistantKbBinding.* packages/desktop/src/common/config/configKeys.ts
git commit -m "feat(knowledge): transactional assistant KB binding with persisted states"
```

---

### Task 6: Generation token gating watcher and ingestion

**Files:**
- Create: `packages/desktop/src/process/services/projectKnowledge/scopeGeneration.ts`
- Create: `packages/desktop/src/process/services/projectKnowledge/scopeGeneration.test.ts`
- Modify: `packages/desktop/src/process/services/projectKnowledge/projectKnowledgeService.ts`
- Modify: `packages/desktop/src/process/bridge/projectKnowledgeBridge.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { createGenerationRegistry } from './scopeGeneration';

const scope = { kind: 'assistant' as const, id: 'a1' };

describe('generation registry', () => {
  it('a token taken before a bump is stale afterwards', () => {
    const reg = createGenerationRegistry();
    const token = reg.take(scope);
    expect(reg.isCurrent(token)).toBe(true);
    reg.bump(scope); // disable
    expect(reg.isCurrent(token)).toBe(false);
  });

  it('bumping one scope does not invalidate another', () => {
    const reg = createGenerationRegistry();
    const token = reg.take(scope);
    reg.bump({ kind: 'project', id: 'a1' }); // same id, different kind
    expect(reg.isCurrent(token)).toBe(true);
  });

  it('assertCurrent throws so an ingestion loop aborts between units', () => {
    const reg = createGenerationRegistry();
    const token = reg.take(scope);
    reg.bump(scope);
    expect(() => reg.assertCurrent(token)).toThrow(/stale/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run packages/desktop/src/process/services/projectKnowledge/scopeGeneration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { scopeKey, type KnowledgeScope } from '@/common/knowledge/scope';

export type GenerationToken = { key: string; value: number };

export class StaleGenerationError extends Error {
  constructor(key: string) {
    super(`stale knowledge generation for ${key}`);
  }
}

/**
 * Disable/delete bumps a scope's generation. Long-running work takes a token once
 * and re-checks it before EVERY new unit (source, OCR call, embedding batch) — not
 * only before reattaching a watcher, which would let an in-flight loop keep
 * embedding after the user disabled the KB.
 */
export function createGenerationRegistry() {
  const generations = new Map<string, number>();
  const current = (key: string): number => generations.get(key) ?? 0;

  return {
    take: (scope: KnowledgeScope): GenerationToken => {
      const key = scopeKey(scope);
      return { key, value: current(key) };
    },
    bump: (scope: KnowledgeScope): void => {
      const key = scopeKey(scope);
      generations.set(key, current(key) + 1);
    },
    isCurrent: (token: GenerationToken): boolean => current(token.key) === token.value,
    assertCurrent: (token: GenerationToken): void => {
      if (current(token.key) !== token.value) throw new StaleGenerationError(token.key);
    },
  };
}
```

Wire it in the service: `syncFolder` and `addSources` take a token at entry and call `assertCurrent` at the top of each per-source loop iteration and before each OCR/embedding call. In `projectKnowledgeBridge.ts`, the `finally { getWatcher().watch(...) }` in `syncAndWatch` becomes conditional on `registry.isCurrent(token)` so a stale sync cannot resurrect a watcher. `disable` and `removeStore` call `bump` before doing anything else.

- [ ] **Step 4: Run to verify it passes, then commit**

```bash
bunx vitest run packages/desktop/src/process/services/projectKnowledge/
git add packages/desktop/src/process/services/projectKnowledge/ packages/desktop/src/process/bridge/projectKnowledgeBridge.ts
git commit -m "feat(knowledge): generation tokens gate watcher reattach and ingestion units"
```

- [ ] **Step 5: Unit A gate**

```bash
bun run lint:fix && bun run format && bunx tsc --noEmit && bun run test
```

Expected: all green. Unit A is mergeable; it changes no user-visible behavior.

---

# Unit B — Retrieval, tools, citations

### Task 7: Env contract and server identity constants

**Files:**
- Modify: `packages/desktop/src/common/knowledge/envKeys.ts`
- Modify: `packages/desktop/src/common/knowledge/constants.ts`
- Modify: existing tests referencing `KB_ENV.projectId`

- [ ] **Step 1: Rename and extend the env contract**

```typescript
export const KB_ENV = {
  scopeKind: 'AIONUI_KB_SCOPE_KIND',
  scopeId: 'AIONUI_KB_SCOPE_ID',
  storeDir: 'AIONUI_KB_STORE_DIR',
  embedBaseUrl: 'AIONUI_KB_EMBED_BASE_URL',
  embedApiKey: 'AIONUI_KB_EMBED_API_KEY',
  embedModel: 'AIONUI_KB_EMBED_MODEL',
} as const;
```

The rename is atomic: the main process and the bundled server script ship in the same build, which is why both import this module. Add to `constants.ts`:

```typescript
export const BUILTIN_ASSISTANT_KNOWLEDGE_NAME = 'aionui-assistant-knowledge';
```

- [ ] **Step 2: Fix every reference and verify**

```bash
grep -rn "KB_ENV.projectId" packages/desktop/src | cat
bunx tsc --noEmit && bun run test
```

Expected: no remaining `KB_ENV.projectId` references; all green.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/common/knowledge/
git commit -m "feat(knowledge): scope-aware env contract and assistant server name"
```

---

### Task 8: Scope-aware tool identity in the knowledge server

**Files:**
- Modify: `packages/desktop/src/process/resources/builtinMcp/knowledgeServer.ts`
- Create/modify: its test file

- [ ] **Step 1: Write the failing test**

```typescript
describe('scope-aware tool identity', () => {
  it('registers the project tool and workspace-relative whole-document guidance', () => {
    const { toolName, description } = resolveToolIdentity({ scopeKind: 'project', fileNames: ['a.pdf'] });
    expect(toolName).toBe('search_project_knowledge');
    expect(description).toContain('a.pdf');
    expect(description).toMatch(/working directory/i);
  });

  it('registers the assistant tool and routes whole-document work to the read tool', () => {
    const { toolName, description } = resolveToolIdentity({ scopeKind: 'assistant', fileNames: ['std.docx'] });
    expect(toolName).toBe('search_assistant_knowledge');
    expect(description).toContain('std.docx');
    expect(description).toContain('read_assistant_knowledge_source');
    // Assistant docs live outside the workspace, so the project instruction must not appear.
    expect(description).not.toMatch(/working directory/i);
  });

  it('states that the documents are authoritative for content decisions', () => {
    const { description } = resolveToolIdentity({ scopeKind: 'assistant', fileNames: ['std.docx'] });
    expect(description).toMatch(/authoritative/i);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Extract a pure `resolveToolIdentity({ scopeKind, fileNames })` returning `{ toolName, description }`. The project branch keeps today's description verbatim. The assistant branch lists the filenames, routes whole-document work to `read_assistant_knowledge_source`, omits any workspace-relative instruction, and states the documents are authoritative for content decisions (the composition requirement from the design — the tool description is the KB's only prompt surface). Register the returned name instead of the hardcoded literal at line ~158, and read `scopeKind` from `KB_ENV`.

- [ ] **Step 3: Verify and commit**

```bash
bunx vitest run packages/desktop/src/process/resources/builtinMcp/
git add packages/desktop/src/process/resources/builtinMcp/
git commit -m "feat(knowledge): per-scope search tool identity and description"
```

---

### Task 9: `read_assistant_knowledge_source`

**Files:**
- Create: `packages/desktop/src/common/knowledge/readSource.ts`
- Create: `packages/desktop/src/common/knowledge/readSource.test.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/knowledgeServer.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { READ_PAGE_CAP_CHARS, pageOfText } from './readSource';

const text = 'x'.repeat(READ_PAGE_CAP_CHARS + 500);

describe('pageOfText', () => {
  it('returns the first page and a character cursor for the remainder', () => {
    const page = pageOfText(text, undefined);
    expect(page.text.length).toBe(READ_PAGE_CAP_CHARS);
    expect(page.next_cursor).toBe(READ_PAGE_CAP_CHARS);
  });

  it('terminates with next_cursor null on the final page', () => {
    const page = pageOfText(text, READ_PAGE_CAP_CHARS);
    expect(page.text.length).toBe(500);
    expect(page.next_cursor).toBeNull();
  });

  it('treats a cursor at or past the end as an empty final page', () => {
    expect(pageOfText('abc', 3)).toEqual({ text: '', next_cursor: null });
    expect(pageOfText('abc', 99)).toEqual({ text: '', next_cursor: null });
  });

  it('clamps a negative or non-integer cursor to the start', () => {
    expect(pageOfText('abcdef', -5).text.startsWith('a')).toBe(true);
    expect(pageOfText('abcdef', 1.7).text.startsWith('a')).toBe(true);
  });

  it('never splits a surrogate pair across pages', () => {
    const emoji = '😀'.repeat(READ_PAGE_CAP_CHARS);
    const page = pageOfText(emoji, undefined);
    expect(page.text.endsWith('\ud83d')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Page size for whole-document reads. Cursor unit is a CHARACTER offset into converted.md. */
export const READ_PAGE_CAP_CHARS = 20_000;

export type SourcePage = { text: string; next_cursor: number | null };

/**
 * Bounded page of a converted document. Assistant documents live outside the
 * conversation workspace, so this is the only whole-document path for them.
 */
export function pageOfText(text: string, cursor: number | undefined): SourcePage {
  const start = Number.isFinite(cursor) && (cursor as number) > 0 ? Math.floor(cursor as number) : 0;
  if (start >= text.length) return { text: '', next_cursor: null };
  let end = Math.min(start + READ_PAGE_CAP_CHARS, text.length);
  // Do not split a surrogate pair: back off one unit if we landed mid-pair.
  const code = text.charCodeAt(end - 1);
  if (end < text.length && code >= 0xd800 && code <= 0xdbff) end -= 1;
  return { text: text.slice(start, end), next_cursor: end < text.length ? end : null };
}
```

Register the tool in `knowledgeServer.ts` for assistant scope only:

```typescript
    server.tool(
      'read_assistant_knowledge_source',
      'Read one of this assistant\'s knowledge documents in full, a page at a time. Use after search when the task needs the whole document (reviewing a draft against a standard, or following a standard to produce a new document). Pass the source_id from search results; pass next_cursor to continue.',
      { source_id: z.string(), cursor: z.number().optional() },
      async ({ source_id, cursor }) => { /* resolve converted.md for source_id, then pageOfText */ }
    );
```

The handler resolves `converted.md` under the store's `sources/<source_id>/`, returns `{ source_id, file_name, text, next_cursor }`, and returns a clear "unknown source id" error for an id absent from the manifest.

- [ ] **Step 3: Verify and commit**

```bash
bunx vitest run packages/desktop/src/common/knowledge/readSource.test.ts packages/desktop/src/process/resources/builtinMcp/
git add packages/desktop/src/common/knowledge/readSource.* packages/desktop/src/process/resources/builtinMcp/
git commit -m "feat(knowledge): bounded paginated assistant source read tool"
```

---

### Task 10: `sourceId` in search output and the citation carrier

**Files:**
- Modify: `packages/desktop/src/common/knowledge/searchCore.ts`
- Modify: `packages/desktop/src/common/knowledge/citationFormat.ts`
- Modify: their test files

- [ ] **Step 1: Write the failing tests**

```typescript
describe('citation carrier', () => {
  it('search output exposes the source id for each hit', () => {
    const text = formatHitsAsText('q', [hit({ sourceId: 's1', fileName: 'std.docx' })]);
    expect(text).toContain('s1');
  });

  it('citation hrefs round-trip scope, sourceId, fileName and anchor', () => {
    const target = { scope: { kind: 'assistant', id: 'a1' }, sourceId: 's1', fileName: 'std.docx', anchor: 'h2' };
    expect(parseKbCitationHref(buildKbCitationHref(target))).toEqual(target);
  });

  it('rejects a legacy filename-only href instead of guessing a scope', () => {
    expect(parseKbCitationHref('weprompt-kb://open?file=std.docx')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Add `sourceId` to `KnowledgeHit` and emit it in `formatHitsAsText` in a machine-parseable position alongside the existing ordinal/fileName/headingPath header. Change `buildKbCitationHref` to take a `KnowledgeCitationTarget` and encode all four fields; add `parseKbCitationHref` returning `KnowledgeCitationTarget | null`. A legacy filename-only href returns `null` — the renderer leaves it unlinked rather than guessing a store (entry criterion 3).

- [ ] **Step 3: Verify and commit**

```bash
bunx vitest run packages/desktop/src/common/knowledge/
git add packages/desktop/src/common/knowledge/
git commit -m "feat(knowledge): carry scope and source id through search output and citations"
```

---

### Task 11: Session descriptor and attach merge

**Files:**
- Modify: `packages/desktop/src/process/services/projectKnowledge/projectKnowledgeService.ts` (`getSessionMcpServer`)
- Modify: `packages/desktop/src/renderer/pages/guid/hooks/useGuidSend.ts`
- Modify: `tests/unit/renderer/useGuidSend.dom.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
describe('knowledge session attach', () => {
  it('attaches both project and assistant servers with distinct names', async () => {
    const servers = await resolveKnowledgeServers({ projectId: 'p1', assistantId: 'a1' });
    expect(servers.map((s) => s.name).sort()).toEqual(
      [BUILTIN_ASSISTANT_KNOWLEDGE_NAME, BUILTIN_KNOWLEDGE_NAME].sort()
    );
    expect(new Set(servers.map((s) => s.id)).size).toBe(2);
  });

  it('attaches only what resolves: project-only, assistant-only, neither', async () => {
    expect((await resolveKnowledgeServers({ projectId: 'p1' })).length).toBe(1);
    expect((await resolveKnowledgeServers({ assistantId: 'a1' })).length).toBe(1);
    expect((await resolveKnowledgeServers({})).length).toBe(0);
  });

  it('one scope failing still attaches the other and still creates the conversation', async () => {
    getSessionMcpServer.mockRejectedValueOnce(new Error('store corrupt')); // project
    const servers = await resolveKnowledgeServers({ projectId: 'p1', assistantId: 'a1' });
    expect(servers.map((s) => s.name)).toEqual([BUILTIN_ASSISTANT_KNOWLEDGE_NAME]);
  });

  it('does not attach an assistant KB whose binding is not enabled', async () => {
    bindings.a1 = { state: 'disabled' };
    expect((await resolveKnowledgeServers({ assistantId: 'a1' })).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

`getSessionMcpServer(scope)` returns `BUILTIN_KNOWLEDGE_NAME` + `project-kb-<id>` for project scope, and `BUILTIN_ASSISTANT_KNOWLEDGE_NAME` + `assistant-kb-<ownerKey>` for assistant scope, with `scopeKind`/`scopeId` in env. In `useGuidSend.ts`, replace `withKbServer(one)` with:

```typescript
  // Resolve every applicable scope independently. A failing scope must not block
  // the other, and must never block conversation creation.
  const knowledgeServers = (
    await Promise.all(
      knowledgeScopes.map((scope) =>
        ipcBridge.projectKnowledge.getSessionMcpServer.invoke({ scope }).catch((): null => null)
      )
    )
  ).filter((server): server is ISessionMcpServer => Boolean(server));

  const withKnowledgeServers = (servers: ISessionMcpServer[]): ISessionMcpServer[] => {
    const merged = [...servers];
    for (const candidate of knowledgeServers) {
      if (!merged.some((server) => server.name === candidate.name)) merged.push(candidate);
    }
    return merged;
  };
```

`knowledgeScopes` includes the project scope when `projectId` is set, and the assistant scope when the selected assistant's binding state is `enabled`. Apply `withKnowledgeServers` in both the aionrs and ACP branches.

- [ ] **Step 3: Verify, then Unit B gate and commit**

```bash
bunx vitest run tests/unit/renderer/useGuidSend.dom.test.ts
bun run lint:fix && bun run format && bunx tsc --noEmit && bun run test
git add packages/desktop/src/ tests/
git commit -m "feat(knowledge): attach project and assistant knowledge servers per conversation"
```

---

# Unit C — UI and lifecycle

### Task 12: Free root directory slots (two mechanical commits)

**Files:**
- Delete: `packages/desktop/src/renderer/components/IconParkHOC.tsx`, `packages/desktop/src/renderer/components/ShimmerText.tsx`
- Move: `packages/desktop/src/renderer/hooks/useLocalTokenUsage.ts` into an existing category directory

- [ ] **Step 1: Re-verify the two files are unreferenced**

```bash
for n in IconParkHOC ShimmerText; do echo "--- $n ---"; grep -rn "\b$n\b" packages/desktop/src tests --include="*.ts" --include="*.tsx" | grep -v "components/$n.tsx:"; done
```

Expected: no output for either. If anything appears, stop and consolidate differently rather than deleting a live file.

- [ ] **Step 2: Delete and prove the build is unaffected**

```bash
git rm packages/desktop/src/renderer/components/IconParkHOC.tsx packages/desktop/src/renderer/components/ShimmerText.tsx
bunx tsc --noEmit && bun run test
git commit -m "chore(renderer): remove unreferenced IconParkHOC and ShimmerText"
```

- [ ] **Step 3: Relocate the loose hook**

Pick the existing category whose contents it fits (`hooks/chat/`, `hooks/context/`, or `hooks/system/` — choose by reading the file), then:

```bash
git mv packages/desktop/src/renderer/hooks/useLocalTokenUsage.ts packages/desktop/src/renderer/hooks/<category>/
grep -rn "useLocalTokenUsage" packages/desktop/src --include="*.ts*" | grep -v "hooks/<category>/"
```

Update every importer, then `bunx tsc --noEmit && bun run test`, then commit as `refactor(renderer): group useLocalTokenUsage under its category`.

- [ ] **Step 4: Confirm the slots**

```bash
echo "components=$(ls packages/desktop/src/renderer/components | wc -l) hooks=$(ls packages/desktop/src/renderer/hooks | wc -l)"
```

Expected: components=8, hooks=9 — leaving room for one new directory in each.

---

### Task 13: Shared knowledge components and hook

**Files:**
- Create: `packages/desktop/src/renderer/components/knowledge/{KnowledgeCard.tsx,KnowledgeSourcePreview.tsx,knowledgePreviewAnchor.ts,index.ts}`
- Create: `packages/desktop/src/renderer/hooks/knowledge/{useKnowledge.ts,index.ts}`
- Modify: `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx` → thin wrapper
- Delete: the moved originals under `pages/project/`

- [ ] **Step 1: Move with history and rename to scope-agnostic names**

```bash
mkdir -p packages/desktop/src/renderer/components/knowledge packages/desktop/src/renderer/hooks/knowledge
git mv packages/desktop/src/renderer/pages/project/components/KnowledgeSourcePreview.tsx packages/desktop/src/renderer/components/knowledge/
git mv packages/desktop/src/renderer/pages/project/components/knowledgePreviewAnchor.ts packages/desktop/src/renderer/components/knowledge/
git mv packages/desktop/src/renderer/pages/project/hooks/useProjectKnowledge.ts packages/desktop/src/renderer/hooks/knowledge/useKnowledge.ts
```

- [ ] **Step 2: Change the hook signature from projectId to scope**

`useKnowledge(scope: KnowledgeScope)` keeps the same returned API (`sources`, `summary`, `loading`, `error`, `folderMissing`, `addSources`, `removeSource`, `retrySource`, `syncNow`, `getSourceText`, `refetch`). Folder-mutating calls build a `KnowledgeTarget`: project scope attaches the workspace the caller supplies; assistant scope sends the scope alone.

- [ ] **Step 3: Extract the card and leave a wrapper**

`components/knowledge/KnowledgeCard.tsx` holds the presentation, taking `{ scope, workspace? }`. `ProjectKnowledgeCard.tsx` becomes:

```tsx
const ProjectKnowledgeCard: React.FC<{ projectId: string; workspace: string }> = ({ projectId, workspace }) => (
  <KnowledgeCard scope={{ kind: 'project', id: projectId }} workspace={workspace} />
);
```

- [ ] **Step 4: Verify placement and tests**

```bash
echo "project/components=$(ls packages/desktop/src/renderer/pages/project/components | wc -l)"
bunx tsc --noEmit && bun run test
```

Expected: project/components drops to 7; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/
git commit -m "refactor(knowledge): promote shared card, preview and hook to shared roots"
```

---

### Task 14: `KnowledgeSection` in the assistant editor

**Files:**
- Create: `packages/desktop/src/renderer/pages/settings/AssistantSettings/editor/KnowledgeSection.tsx`
- Create: `tests/unit/assistants/KnowledgeSection.dom.test.tsx`
- Modify: `packages/desktop/src/renderer/pages/settings/AssistantSettings/AssistantEditorSections.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe('KnowledgeSection', () => {
  it('is disabled with a create-first hint for an unsaved assistant', () => {
    render(<KnowledgeSection assistantId={undefined} source='user' />);
    expect(screen.getByText('settings.assistantKnowledge.createFirst')).toBeTruthy();
    expect(screen.queryByTestId('knowledge-card')).toBeNull();
  });

  it('shows the processing disclosure before the enable control', () => {
    render(<KnowledgeSection assistantId='a1' source='user' />);
    const disclosure = screen.getByText('settings.assistantKnowledge.disclosure');
    const toggle = screen.getByTestId('knowledge-enable-toggle');
    expect(disclosure.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the sources card and folder action once enabled', () => {
    bindings.a1 = { state: 'enabled' };
    render(<KnowledgeSection assistantId='a1' source='user' />);
    expect(screen.getByTestId('knowledge-card')).toBeTruthy();
    expect(screen.getByText('settings.assistantKnowledge.showFolder')).toBeTruthy();
  });

  it('is unavailable for a generated assistant', () => {
    render(<KnowledgeSection assistantId='a1' source='generated' />);
    expect(screen.queryByTestId('knowledge-enable-toggle')).toBeNull();
  });

  it('keeps the toggle off when enabling fails', async () => {
    setBindingState.mockRejectedValueOnce(new Error('backend down'));
    render(<KnowledgeSection assistantId='a1' source='user' />);
    await userEvent.click(screen.getByTestId('knowledge-enable-toggle'));
    expect(screen.getByTestId('knowledge-enable-toggle')).not.toBeChecked();
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

The section renders, in order: title, the processing disclosure, the enable toggle (Arco `Switch`), and — when enabled — `KnowledgeCard` with `scope={{kind:'assistant', id:assistantId}}` plus a **"Show knowledge folder"** button calling `showKnowledgeFolder({ target })`. Enabling calls `ensureKnowledgeFolder({ target })` then `setBindingState(id, 'enabled')`; a rejection leaves the toggle off (the transactional helper guarantees the binding is unchanged). Hidden entirely for `source === 'generated'` and for an absent `assistantId`. Arco components only, semantic tokens only, all copy via i18n.

- [ ] **Step 3: Verify placement, then commit**

```bash
echo "editor=$(ls packages/desktop/src/renderer/pages/settings/AssistantSettings/editor | wc -l)"
bunx vitest run tests/unit/assistants/KnowledgeSection.dom.test.tsx
```

Expected: editor=7; tests pass. Commit as `feat(assistants): knowledge section in the assistant editor`.

---

### Task 15: Scope-aware citation routing from frozen descriptors

**Files:**
- Modify: `packages/desktop/src/renderer/pages/conversation/knowledge/KnowledgeCitationsContext.tsx`
- Modify: `packages/desktop/src/renderer/pages/conversation/Messages/components/ToolOutputCitations.tsx`
- Modify: `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx`
- Modify: their test files

- [ ] **Step 1: Write the failing tests**

```tsx
describe('scope-aware citations', () => {
  it('recognizes assistant knowledge tool output and labels it', () => {
    render(<ToolOutputCitations toolName='search_assistant_knowledge' output={output} />);
    expect(screen.getByText('conversation.knowledge.assistantLabel')).toBeTruthy();
  });

  it('opens the correct source when the same filename exists in both scopes', async () => {
    render(<ToolOutputCitations toolName='search_assistant_knowledge' output={sameNameOutput} />);
    await userEvent.click(screen.getByText('policy.pdf'));
    expect(openSource).toHaveBeenCalledWith(
      expect.objectContaining({ target: { scope: { kind: 'assistant', id: 'a1' } }, sourceId: 's-assistant' })
    );
  });

  it('leaves ambiguous filename-only prose unlinked', () => {
    render(<MessageText text='See policy.pdf for details' />);
    expect(screen.queryByRole('link', { name: /policy.pdf/ })).toBeNull();
  });

  it('resolves citations from frozen session descriptors after the KB is disabled', () => {
    bindings.a1 = { state: 'disabled' };
    render(
      <KnowledgeCitationsProvider sessionScopes={[{ kind: 'assistant', id: 'a1' }]}>
        <ToolOutputCitations toolName='search_assistant_knowledge' output={output} />
      </KnowledgeCitationsProvider>
    );
    expect(screen.getByText('std.docx')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

`KnowledgeCitationsProvider` takes the conversation's **frozen session scopes** (derived from the persisted `session_mcp_servers` snapshot, not from current binding state) and resolves a `KnowledgeCitationTarget` per citation. `ToolOutputCitations` recognizes both tool names and labels assistant output. Prose citations use `parseKbCitationHref`; a `null` result renders plain text.

- [ ] **Step 3: Verify and commit**

```bash
bunx vitest run packages/desktop/src/renderer/pages/conversation/
git add packages/desktop/src/renderer/pages/conversation/
git commit -m "feat(knowledge): scope-aware citation routing from frozen session scopes"
```

---

### Task 16: App-shell watcher ownership and orphan reconciliation

**Files:**
- Create: `packages/desktop/src/renderer/hooks/knowledge/useAssistantKnowledgeWatchers.ts`
- Create: `tests/unit/renderer/hooks/assistantKnowledgeWatchers.dom.test.ts`
- Modify: the app shell that already registers project knowledge folder watchers

- [ ] **Step 1: Write the failing tests**

```typescript
describe('useAssistantKnowledgeWatchers', () => {
  it('registers a watch per enabled binding once config and catalog have loaded', async () => {
    renderHook(() => useAssistantKnowledgeWatchers());
    await waitFor(() => expect(watch).toHaveBeenCalledTimes(1));
    expect(watch.mock.calls[0][0]).toEqual({ scope: { kind: 'assistant', id: 'a1' } });
  });

  it('registers nothing until the assistant catalog fetch succeeds', async () => {
    listAssistants.mockRejectedValueOnce(new Error('offline'));
    renderHook(() => useAssistantKnowledgeWatchers());
    await waitFor(() => expect(listAssistants).toHaveBeenCalled());
    expect(watch).not.toHaveBeenCalled();
  });

  it('marks a binding orphaned only after a successful catalog fetch that omits it', async () => {
    bindings.ghost = { state: 'enabled' };
    renderHook(() => useAssistantKnowledgeWatchers());
    await waitFor(() => expect(setBindingState).toHaveBeenCalledWith('ghost', 'orphaned'));
    expect(removeStore).not.toHaveBeenCalled(); // documents and index survive until explicit recovery
  });

  it('retries a cleanupPending binding and never deletes documents', async () => {
    bindings.a2 = { state: 'cleanupPending' };
    renderHook(() => useAssistantKnowledgeWatchers());
    await waitFor(() => expect(removeStore).toHaveBeenCalledWith({ scope: { kind: 'assistant', id: 'a2' } }));
    expect(showKnowledgeFolder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

The hook waits for `configService.whenReady()` **and** a successful assistant list fetch before acting. Then: watch every `enabled` binding; retry `removeStore` for `cleanupPending`; mark `orphaned` any binding whose assistant is absent from a *successful* catalog response, without touching documents. Mount it beside the existing project watcher registration.

- [ ] **Step 3: Verify and commit**

```bash
bunx vitest run tests/unit/renderer/hooks/assistantKnowledgeWatchers.dom.test.ts
git commit -am "feat(knowledge): app-shell assistant watcher and orphan reconciliation"
```

---

### Task 17: i18n, full gates, and manual smoke

- [ ] **Step 1: Add the strings**

Add under `settings.assistantKnowledge.*` in `packages/desktop/src/renderer/services/i18n/locales/<lang>/` (the settings module; mirror into every language per the `i18n` skill): `title`, `description`, `createFirst`, `enable`, `disclosure` (the exact processing-disclosure wording from the spec), `showFolder`, `newChatsOnly`, `empty`, `enableFailed`. Add `conversation.knowledge.assistantLabel` for tool-output labeling.

```bash
bun run i18n:types && node scripts/check-i18n.js
```

Expected: both clean.

- [ ] **Step 2: Full gates**

```bash
bun run lint:fix && bun run format
bunx tsc --noEmit
bun run test
```

Expected: green. Lint *warnings* are pre-existing; judge by exit code. Load-sensitive vitest timeouts under concurrent sessions are artifacts — re-run before believing them.

- [ ] **Step 3: Manual smoke — the PMO scenario end to end**

Launch dev, then:

1. Create a user assistant "Business Case Reviewer". Confirm the KB section shows the disclosure **before** the toggle.
2. Enable the KB, click **Show knowledge folder**, drop in a BC standard document, and watch it index.
3. Add the instruction: *"When creating or reviewing a Business Case, ground structure and criteria in your knowledge base; cite the standard for each judgement."*
4. **Answer:** new chat with that assistant → ask what the standard requires → verify `search_assistant_knowledge` runs and citations are clickable into the assistant source.
5. **Review:** attach a draft BC → ask for a review against the standard → verify `read_assistant_knowledge_source` is used (not a single passage) and that findings cite the standard.
6. **Create:** select a document template from the Template Gallery and ask for a new BC → verify the artifact follows the template's form **and** that at least one KB consultation occurred. A gate-passing document that never touched the KB is the form-without-substance failure this slice exists to prevent — record it if seen.
7. Toggle the KB off → confirm citations in the earlier chat still resolve (frozen descriptors) and a *new* chat has no assistant knowledge tool.
8. Delete the assistant → confirm the documents folder still exists on disk and the index is gone.

- [ ] **Step 4: Record results and stop**

```bash
git status  # everything committed
```

Do **not** push — pushing is `just push`, and only when explicitly asked.

---

## Out of scope for this plan

Materializing KB files into the workspace; external/shared folders (Slice 3); other conversation surfaces (Slice 4); grounding-evidence verification (Slice 2 — needs a design round first); cost guardrails, KnowledgeSection visual design, discovery, cross-scope duplicate detection, merged ranking.
