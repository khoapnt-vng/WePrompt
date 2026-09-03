# Project Home Screen — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the visual-independent foundation of the per-project Home screen — the `/project/:id` route, its data hooks, the project-`instructions` data field, the sidebar retarget, and a minimal functional page shell — all test-covered.

**Architecture:** Renderer-only, reuse-heavy. Pure logic (conversation selection, navigation targets, storage) is isolated into standalone functions tested in the Vitest `node` project; thin React hooks/page wrap them and are tested in the `dom` project with `@testing-library/react`. The styled UI (composer richness, chat-row design, instructions card, files card, responsive polish) is intentionally deferred to a later "visual" plan once the designer's mockups land.

**Tech Stack:** TypeScript (strict), React 18, react-router-dom (`HashRouter`), `@arco-design/web-react`, UnoCSS, react-i18next (typed keys), Vitest 4 (`node` + `jsdom` projects), `@testing-library/react`.

---

## Scope

**In scope (this plan):** `instructions?` field on `ForgeProject` + storage threading; pure `selectProjectConversations`; pure `projectNavigation` helpers; `useProjectHome` + `useProjectChats` hooks; a minimal `ProjectHomePage` shell (project name, new-chat entry, chats list, empty/not-found states, reserved rail slots); i18n keys; the `/project/:id` route; the sidebar retarget.

**Deferred (later visual plan):** styled header/menu, rich composer, chat-row visuals, the instructions view/edit card, the files/knowledge card, responsive two-column polish, full copy. The page shell here leaves labelled slots (`data-testid="project-instructions-slot"`, `data-testid="project-files-slot"`) for those.

**Coordination note:** the `instructions` field defined in Task 1 uses the exact names from `2026-07-22-global-project-context-design.md` so the merge with `feat/global-user-context` is a trivial identical-field reconciliation. This plan only *stores/edits-later* the field; prompt injection stays on the sibling branch.

---

## File Structure

**Create:**
- `packages/desktop/src/renderer/pages/conversation/projects/selectProjectConversations.ts` — pure: filter+sort a project's conversations
- `packages/desktop/src/renderer/pages/conversation/projects/projectNavigation.ts` — pure: build the home path, resolve a sidebar click target
- `packages/desktop/src/renderer/pages/project/index.tsx` — lazy default export
- `packages/desktop/src/renderer/pages/project/ProjectHomePage.tsx` — page shell orchestrator
- `packages/desktop/src/renderer/pages/project/hooks/useProjectHome.ts` — load project by id, not-found, stamp `last_opened_at`
- `packages/desktop/src/renderer/pages/project/hooks/useProjectChats.ts` — derive the project's conversations from context
- Tests: `packages/desktop/src/renderer/pages/conversation/projects/projectStorage.instructions.test.ts`, `selectProjectConversations.test.ts`, `projectNavigation.test.ts` (node); `tests/unit/pages/project/useProjectHome.dom.test.tsx`, `tests/unit/pages/project/ProjectHomePage.dom.test.tsx` (dom)

**Modify:**
- `packages/desktop/src/common/types/project/projectTypes.ts` — add `instructions?: string`
- `packages/desktop/src/renderer/pages/conversation/projects/projectStorage.ts` — validate + thread `instructions`
- `packages/desktop/src/renderer/services/i18n/locales/*/conversation.json` (12 files) — `projectHome` keys
- `packages/desktop/src/renderer/components/layout/Router.tsx` — register `/project/:id`
- `packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx` — retarget project click to Home

---

## Task 1: Add `instructions` to the Project data model

**Files:**
- Modify: `packages/desktop/src/common/types/project/projectTypes.ts`
- Modify: `packages/desktop/src/renderer/pages/conversation/projects/projectStorage.ts`
- Test: `packages/desktop/src/renderer/pages/conversation/projects/projectStorage.instructions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/renderer/pages/conversation/projects/projectStorage.instructions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ProjectStorageLike } from '@renderer/pages/conversation/projects/projectStorage';
import { PROJECT_STORAGE_KEY, createProject, readProjects, updateProject } from '@renderer/pages/conversation/projects/projectStorage';

const makeStorage = (initial?: string): ProjectStorageLike => {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(PROJECT_STORAGE_KEY, initial);
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
};

const deps = (storage: ProjectStorageLike, id = 'p1') => ({ storage, now: () => 1, createId: () => id });

describe('project storage instructions field', () => {
  it('persists instructions on create', () => {
    const storage = makeStorage();
    createProject({ name: 'Alpha', workspace: '/w/alpha', instructions: 'Be concise.' }, deps(storage));
    expect(readProjects(storage)[0].instructions).toBe('Be concise.');
  });

  it('sets instructions via updateProject on an existing project', () => {
    const storage = makeStorage();
    createProject({ name: 'Alpha', workspace: '/w/alpha' }, deps(storage));
    updateProject({ id: 'p1', instructions: 'Answer in English.' }, { storage, now: () => 2 });
    expect(readProjects(storage)[0].instructions).toBe('Answer in English.');
  });

  it('leaves instructions untouched when updateProject omits the field', () => {
    const storage = makeStorage();
    createProject({ name: 'Alpha', workspace: '/w/alpha', instructions: 'Keep it.' }, deps(storage));
    updateProject({ id: 'p1', name: 'Alpha 2' }, { storage, now: () => 2 });
    expect(readProjects(storage)[0].instructions).toBe('Keep it.');
  });

  it('rejects a stored project whose instructions is not a string', () => {
    const badRaw = JSON.stringify([{ id: 'p1', name: 'A', workspace: '/w/a', created_at: 1, updated_at: 1, instructions: 123 }]);
    expect(readProjects(makeStorage(badRaw))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run packages/desktop/src/renderer/pages/conversation/projects/projectStorage.instructions.test.ts`
Expected: FAIL — TypeScript error that `instructions` does not exist on `CreateForgeProjectInput` / `UpdateForgeProjectInput`, and (once types exist) the create/update assertions fail because storage strips the field.

- [ ] **Step 3: Add the field to the types**

In `packages/desktop/src/common/types/project/projectTypes.ts`, add `instructions?: string;` as the last field of all three types:

```ts
export type ForgeProject = {
  id: string;
  name: string;
  workspace: string;
  created_at: number;
  updated_at: number;
  last_opened_at?: number;
  instructions?: string;
};

export type CreateForgeProjectInput = {
  name: string;
  workspace: string;
  instructions?: string;
};

export type UpdateForgeProjectInput = {
  id: string;
  name?: string;
  workspace?: string;
  last_opened_at?: number;
  instructions?: string;
};
```

- [ ] **Step 4: Thread the field through storage**

In `packages/desktop/src/renderer/pages/conversation/projects/projectStorage.ts`:

Extend `isForgeProject` — add the trailing clause:

```ts
    (value.last_opened_at === undefined || typeof value.last_opened_at === 'number') &&
    (value.instructions === undefined || typeof value.instructions === 'string')
  );
```

In `createProject`, add instructions to the constructed `project` (after the `updated_at: timestamp,` line):

```ts
  const project: ForgeProject = {
    id: createId(),
    name,
    workspace,
    created_at: timestamp,
    updated_at: timestamp,
    ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
  };
```

In `updateProject`, add instructions to the constructed `updated` (after the `last_opened_at` spread line):

```ts
  const updated: ForgeProject = {
    ...target,
    ...(input.name !== undefined ? { name: input.name.trim() || getWorkspaceBasename(nextWorkspace) } : {}),
    workspace: nextWorkspace,
    ...(input.last_opened_at !== undefined ? { last_opened_at: input.last_opened_at } : {}),
    ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
    updated_at: now(),
  };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bunx vitest run packages/desktop/src/renderer/pages/conversation/projects/projectStorage.instructions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck & commit**

Run: `bunx tsc --noEmit` → Expected: no errors.

```bash
git add packages/desktop/src/common/types/project/projectTypes.ts packages/desktop/src/renderer/pages/conversation/projects/projectStorage.ts packages/desktop/src/renderer/pages/conversation/projects/projectStorage.instructions.test.ts
git commit -m "feat(project): add optional instructions field to ForgeProject storage"
```

---

## Task 2: Pure `selectProjectConversations`

**Files:**
- Create: `packages/desktop/src/renderer/pages/conversation/projects/selectProjectConversations.ts`
- Test: `packages/desktop/src/renderer/pages/conversation/projects/selectProjectConversations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `selectProjectConversations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import type { ForgeProject } from '@/common/types/project/projectTypes';
import { selectProjectConversations } from '@renderer/pages/conversation/projects/selectProjectConversations';

const project: ForgeProject = { id: 'p1', name: 'Alpha', workspace: '/w/alpha', created_at: 1, updated_at: 1 };

const conv = (id: string, extra: Record<string, unknown>, modified_at = 0): TChatConversation =>
  ({ id, name: id, extra, modified_at, created_at: 0, type: 'acp', model: {} }) as unknown as TChatConversation;

describe('selectProjectConversations', () => {
  it('matches conversations by project_id', () => {
    const list = [conv('a', { project_id: 'p1' }), conv('b', { project_id: 'other' })];
    expect(selectProjectConversations(list, project).map((c) => c.id)).toEqual(['a']);
  });

  it('matches by workspace when project_id is absent', () => {
    const list = [conv('a', { workspace: '/w/alpha' }), conv('b', { workspace: '/w/other' })];
    expect(selectProjectConversations(list, project).map((c) => c.id)).toEqual(['a']);
  });

  it('sorts matches by modified_at descending', () => {
    const list = [conv('old', { project_id: 'p1' }, 1), conv('new', { project_id: 'p1' }, 2)];
    expect(selectProjectConversations(list, project).map((c) => c.id)).toEqual(['new', 'old']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run packages/desktop/src/renderer/pages/conversation/projects/selectProjectConversations.test.ts`
Expected: FAIL — cannot resolve module `selectProjectConversations` (not created yet).

- [ ] **Step 3: Write the implementation**

Create `selectProjectConversations.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import type { ForgeProject } from '@/common/types/project/projectTypes';

import { resolveConversationProject } from './projectConversation';

/**
 * Conversations that belong to the given project — matched by `extra.project_id`
 * or, failing that, by workspace path — newest first.
 */
export const selectProjectConversations = (conversations: TChatConversation[], project: ForgeProject): TChatConversation[] =>
  conversations
    .filter((conversation) => resolveConversationProject(conversation, [project])?.id === project.id)
    .toSorted((a, b) => b.modified_at - a.modified_at);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run packages/desktop/src/renderer/pages/conversation/projects/selectProjectConversations.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/conversation/projects/selectProjectConversations.ts packages/desktop/src/renderer/pages/conversation/projects/selectProjectConversations.test.ts
git commit -m "feat(project): add selectProjectConversations selector"
```

---

## Task 3: Pure `projectNavigation` helpers

**Files:**
- Create: `packages/desktop/src/renderer/pages/conversation/projects/projectNavigation.ts`
- Test: `packages/desktop/src/renderer/pages/conversation/projects/projectNavigation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `projectNavigation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildProjectHomePath, resolveProjectClickTarget } from '@renderer/pages/conversation/projects/projectNavigation';

describe('projectNavigation', () => {
  it('builds the home path for an id', () => {
    expect(buildProjectHomePath('p1')).toBe('/project/p1');
  });

  it('encodes ids that need escaping', () => {
    expect(buildProjectHomePath('a/b')).toBe('/project/a%2Fb');
  });

  it('routes a saved project to its home', () => {
    expect(resolveProjectClickTarget({ project_id: 'p1', workspace: '/w/a' })).toEqual({ kind: 'home', path: '/project/p1' });
  });

  it('routes a legacy workspace (no project_id) to a scoped chat', () => {
    expect(resolveProjectClickTarget({ workspace: '/w/a' })).toEqual({ kind: 'chat', workspace: '/w/a' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run packages/desktop/src/renderer/pages/conversation/projects/projectNavigation.test.ts`
Expected: FAIL — cannot resolve module `projectNavigation`.

- [ ] **Step 3: Write the implementation**

Create `projectNavigation.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Hash-router path for a project's Home page. */
export const buildProjectHomePath = (projectId: string): string => `/project/${encodeURIComponent(projectId)}`;

export type ProjectClickTarget = { kind: 'home'; path: string } | { kind: 'chat'; workspace: string };

/**
 * Where clicking a sidebar project group should go: a saved project (has an id)
 * opens its Home page; a legacy workspace group falls back to a scoped new chat.
 */
export const resolveProjectClickTarget = (group: { project_id?: string; workspace: string }): ProjectClickTarget =>
  group.project_id ? { kind: 'home', path: buildProjectHomePath(group.project_id) } : { kind: 'chat', workspace: group.workspace };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run packages/desktop/src/renderer/pages/conversation/projects/projectNavigation.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/conversation/projects/projectNavigation.ts packages/desktop/src/renderer/pages/conversation/projects/projectNavigation.test.ts
git commit -m "feat(project): add project navigation helpers"
```

---

## Task 4: `useProjectHome` hook

**Files:**
- Create: `packages/desktop/src/renderer/pages/project/hooks/useProjectHome.ts`
- Test: `tests/unit/pages/project/useProjectHome.dom.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pages/project/useProjectHome.dom.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { PROJECT_STORAGE_KEY } from '@renderer/pages/conversation/projects/projectStorage';
import { useProjectHome } from '@renderer/pages/project/hooks/useProjectHome';

const seed = (projects: unknown[]) => window.localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(projects));
const project = { id: 'p1', name: 'Alpha', workspace: '/w/alpha', created_at: 1, updated_at: 1 };

describe('useProjectHome', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns the project matching the id', () => {
    seed([project]);
    const { result } = renderHook(() => useProjectHome('p1'));
    expect(result.current.project?.name).toBe('Alpha');
    expect(result.current.notFound).toBe(false);
  });

  it('flags notFound for an unknown id', () => {
    seed([]);
    const { result } = renderHook(() => useProjectHome('missing'));
    expect(result.current.project).toBeNull();
    expect(result.current.notFound).toBe(true);
  });

  it('stamps last_opened_at when the project opens', () => {
    seed([project]);
    renderHook(() => useProjectHome('p1'));
    const stored = JSON.parse(window.localStorage.getItem(PROJECT_STORAGE_KEY) as string);
    expect(typeof stored[0].last_opened_at).toBe('number');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/pages/project/useProjectHome.dom.test.tsx`
Expected: FAIL — cannot resolve module `useProjectHome`.

- [ ] **Step 3: Write the implementation**

Create `packages/desktop/src/renderer/pages/project/hooks/useProjectHome.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ForgeProject } from '@/common/types/project/projectTypes';
import { useEffect, useMemo, useRef } from 'react';

import { updateProject } from '@renderer/pages/conversation/projects/projectStorage';
import { useProjects } from '@renderer/pages/conversation/projects/useProjects';

export type UseProjectHomeResult = {
  project: ForgeProject | null;
  notFound: boolean;
};

/**
 * Resolve a Project by route id from local storage, stamping `last_opened_at`
 * once per opened project. `notFound` is true when an id was given but no
 * project matches (Projects load synchronously, so there is no loading gap).
 */
export const useProjectHome = (projectId: string | undefined): UseProjectHomeResult => {
  const { projects } = useProjects();
  const project = useMemo(() => projects.find((candidate) => candidate.id === projectId) ?? null, [projects, projectId]);

  const stampedId = useRef<string | null>(null);
  useEffect(() => {
    if (project && stampedId.current !== project.id) {
      stampedId.current = project.id;
      updateProject({ id: project.id, last_opened_at: Date.now() });
    }
  }, [project]);

  return { project, notFound: projectId !== undefined && project === null };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run tests/unit/pages/project/useProjectHome.dom.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/project/hooks/useProjectHome.ts tests/unit/pages/project/useProjectHome.dom.test.tsx
git commit -m "feat(project): add useProjectHome hook"
```

---

## Task 5: i18n keys for the page shell

**Files:**
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/conversation.json` (all 12 locales: `de-DE`, `en-US`, `es-ES`, `fa-IR`, `ja-JP`, `ko-KR`, `pt-BR`, `ru-RU`, `tr-TR`, `uk-UA`, `zh-CN`, `zh-TW`)

- [ ] **Step 1: Add the `projectHome` block to en-US**

REQUIRED SUB-SKILL: follow the `i18n` skill (`.claude/skills/i18n/SKILL.md`) — it owns translation for the non-English locales. Add a top-level `projectHome` object to `packages/desktop/src/renderer/services/i18n/locales/en-US/conversation.json` (source of truth for the keys):

```json
  "projectHome": {
    "newChat": "New chat",
    "chats": "Chats",
    "emptyChats": "No chats yet — start one above.",
    "notFound": "Project not found.",
    "backHome": "Back to home"
  }
```

- [ ] **Step 2: Mirror the keys into the other 11 locales**

Add the same `projectHome` keys (translated per the `i18n` skill) to each other `*/conversation.json`. Keys must be present in every locale for validation to pass.

- [ ] **Step 3: Regenerate types and validate**

Run: `bun run i18n:types` → Expected: regenerates the i18n key type; exit 0.
Run: `node scripts/check-i18n.js` → Expected: no missing-key errors across locales.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/services/i18n/locales
git commit -m "feat(project): add project home i18n keys"
```

---

## Task 6: `useProjectChats` hook + `ProjectHomePage` shell

**Files:**
- Create: `packages/desktop/src/renderer/pages/project/hooks/useProjectChats.ts`
- Create: `packages/desktop/src/renderer/pages/project/ProjectHomePage.tsx`
- Create: `packages/desktop/src/renderer/pages/project/index.tsx`
- Test: `tests/unit/pages/project/ProjectHomePage.dom.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pages/project/ProjectHomePage.dom.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PROJECT_STORAGE_KEY } from '@renderer/pages/conversation/projects/projectStorage';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

vi.mock('@renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => ({
    conversations: [
      { id: 'c1', name: 'First chat', extra: { project_id: 'p1' }, modified_at: 2, created_at: 0, type: 'acp', model: {} },
      { id: 'c2', name: 'Other chat', extra: { project_id: 'zzz' }, modified_at: 1, created_at: 0, type: 'acp', model: {} },
    ],
  }),
}));

import ProjectHomePage from '@renderer/pages/project/ProjectHomePage';

const seedProject = () =>
  window.localStorage.setItem(
    PROJECT_STORAGE_KEY,
    JSON.stringify([{ id: 'p1', name: 'Alpha Project', workspace: '/w/alpha', created_at: 1, updated_at: 1 }])
  );

const renderAt = (id: string) =>
  render(
    <MemoryRouter initialEntries={[`/project/${id}`]}>
      <Routes>
        <Route path='/project/:id' element={<ProjectHomePage />} />
      </Routes>
    </MemoryRouter>
  );

describe('ProjectHomePage', () => {
  beforeEach(() => window.localStorage.clear());

  it('renders the project name and only its own chats', () => {
    seedProject();
    renderAt('p1');
    expect(screen.getByText('Alpha Project')).toBeInTheDocument();
    expect(screen.getByText('First chat')).toBeInTheDocument();
    expect(screen.queryByText('Other chat')).not.toBeInTheDocument();
  });

  it('shows a not-found state for an unknown project', () => {
    renderAt('missing');
    expect(screen.getByTestId('project-not-found')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/unit/pages/project/ProjectHomePage.dom.test.tsx`
Expected: FAIL — cannot resolve `ProjectHomePage` / `useProjectChats`.

- [ ] **Step 3: Write `useProjectChats`**

Create `packages/desktop/src/renderer/pages/project/hooks/useProjectChats.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import type { ForgeProject } from '@/common/types/project/projectTypes';
import { useMemo } from 'react';

import { useConversationHistoryContext } from '@renderer/hooks/context/ConversationHistoryContext';
import { selectProjectConversations } from '@renderer/pages/conversation/projects/selectProjectConversations';

/** The given project's conversations, newest first (empty when project is null). */
export const useProjectChats = (project: ForgeProject | null): TChatConversation[] => {
  const { conversations } = useConversationHistoryContext();
  return useMemo(() => (project ? selectProjectConversations(conversations, project) : []), [conversations, project]);
};
```

- [ ] **Step 4: Write `ProjectHomePage`**

Create `packages/desktop/src/renderer/pages/project/ProjectHomePage.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Empty } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { useProjectChats } from './hooks/useProjectChats';
import { useProjectHome } from './hooks/useProjectHome';

/**
 * Foundation shell for the per-project Home page. Renders the project name, a
 * scoped new-chat entry, and the chats list. The right-rail slots
 * (instructions, files) are reserved for the later visual plan.
 */
const ProjectHomePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { project, notFound } = useProjectHome(id);
  const chats = useProjectChats(project);

  if (notFound || !project) {
    return (
      <div data-testid='project-not-found' className='flex flex-col items-center justify-center h-full gap-12px'>
        <span className='text-t-secondary'>{t('conversation.projectHome.notFound')}</span>
        <Button type='primary' onClick={() => void navigate('/guid')}>
          {t('conversation.projectHome.backHome')}
        </Button>
      </div>
    );
  }

  const startNewChat = () => void navigate('/guid', { state: { workspace: project.workspace, projectId: project.id } });

  return (
    <div data-testid='project-home' className='flex h-full min-h-0'>
      <div className='flex-1 min-w-0 flex flex-col gap-16px p-24px overflow-auto'>
        <header className='min-w-0'>
          <h1 className='text-18px font-[600] text-t-primary truncate'>{project.name}</h1>
          <p className='text-12px text-t-secondary truncate'>{project.workspace}</p>
        </header>

        <Button type='primary' className='self-start' onClick={startNewChat}>
          {t('conversation.projectHome.newChat')}
        </Button>

        <section className='min-w-0'>
          <h2 className='text-14px font-[500] text-t-secondary mb-8px'>{t('conversation.projectHome.chats')}</h2>
          {chats.length === 0 ? (
            <Empty description={t('conversation.projectHome.emptyChats')} />
          ) : (
            <ul className='flex flex-col gap-4px'>
              {chats.map((chat) => (
                <li key={chat.id} className='min-w-0'>
                  <Button long type='text' className='!justify-start !text-t-primary' onClick={() => void navigate(`/conversation/${chat.id}`)}>
                    <span className='truncate'>{chat.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Reserved for the visual plan: instructions + files cards. */}
      <aside data-testid='project-rail' className='w-320px shrink-0 p-24px overflow-auto'>
        <div data-testid='project-instructions-slot' />
        <div data-testid='project-files-slot' />
      </aside>
    </div>
  );
};

export default ProjectHomePage;
```

- [ ] **Step 5: Write the lazy index export**

Create `packages/desktop/src/renderer/pages/project/index.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export { default } from './ProjectHomePage';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bunx vitest run tests/unit/pages/project/ProjectHomePage.dom.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck & commit**

Run: `bunx tsc --noEmit` → Expected: no errors.

```bash
git add packages/desktop/src/renderer/pages/project tests/unit/pages/project/ProjectHomePage.dom.test.tsx
git commit -m "feat(project): add ProjectHomePage shell and useProjectChats hook"
```

---

## Task 7: Register the `/project/:id` route

**Files:**
- Modify: `packages/desktop/src/renderer/components/layout/Router.tsx`

- [ ] **Step 1: Add the lazy import**

After the `TeamIndex` lazy import (line ~23), add:

```ts
const ProjectHome = React.lazy(() => import('@renderer/pages/project'));
```

- [ ] **Step 2: Add the route**

Inside the `<Route element={<ProtectedLayout layout={layout} />}>` block, directly after the `/conversation/:id` route, add:

```tsx
          <Route path='/project/:id' element={withRouteFallback(ProjectHome)} />
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify manually in the app**

Run the app (`bun run` dev per the project's run steps), then navigate the in-app browser to `#/project/<an-existing-project-id>` (grab an id from `localStorage['forge.projects.v1']` via devtools). Expected: the Project Home shell renders (name + chats); an unknown id shows the not-found state.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/layout/Router.tsx
git commit -m "feat(project): register /project/:id route"
```

---

## Task 8: Retarget the sidebar project click to Home

**Context:** Today a project group's header click calls `WorkspaceCollapse`'s `onToggle` (`handleToggleWorkspace`), which **expands the group to show its chats inline** — it does not start a chat. Per the approved design, clicking a *saved* project now opens its Home page; *legacy* workspace groups (no `project_id`) keep today's expand behavior. The per-row "+" button and the menu "New chat" item are unchanged (they remain the direct scoped-new-chat shortcuts). The pure decision is already unit-tested in Task 3 (`resolveProjectClickTarget`); this task only wires it in. No full-component render test is added here (the giant `GroupedHistory` component is impractical to render in isolation and the decision logic is already covered) — Step 3 is a manual verification instead.

**Files:**
- Modify: `packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx`

- [ ] **Step 1: Import the helper**

Add to the imports that pull from `./` project modules (near the other `projects/*` imports in the file; the module path from `GroupedHistory/index.tsx` is `../projects/projectNavigation`):

```ts
import { resolveProjectClickTarget } from '../projects/projectNavigation';
```

Verify the exact relative path resolves (`GroupedHistory/` and `projects/` are sibling dirs under `pages/conversation/`). If the file already imports from `@renderer/pages/conversation/projects/...`, use that alias form instead for consistency:

```ts
import { resolveProjectClickTarget } from '@renderer/pages/conversation/projects/projectNavigation';
```

- [ ] **Step 2: Wire the project header click**

Find the project-group `<WorkspaceCollapse>` (around line 639-641):

```tsx
                    <WorkspaceCollapse
                      expanded={expandedWorkspaces.includes(group.workspace)}
                      onToggle={() => handleToggleWorkspace(group.workspace)}
```

Replace the `onToggle` line with:

```tsx
                    <WorkspaceCollapse
                      expanded={expandedWorkspaces.includes(group.workspace)}
                      onToggle={() => {
                        const target = resolveProjectClickTarget(group);
                        if (target.kind === 'home') {
                          void navigate(target.path);
                        } else {
                          handleToggleWorkspace(group.workspace);
                        }
                      }}
```

(`navigate` is already in scope in this component — it backs `navigateToProjectChat`.)

- [ ] **Step 3: Typecheck & manual verification**

Run: `bunx tsc --noEmit` → Expected: no errors.

In the app: click a **saved** project in the sidebar → lands on `/project/:id` (Home). Click a **legacy** workspace group (one shown without project actions) → still expands inline. The per-row "+" and the "New chat" menu item → still open a scoped new chat.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx
git commit -m "feat(project): open project Home from the sidebar for saved projects"
```

---

## Final verification

- [ ] Run the full gate:

```bash
bunx vitest run
bunx tsc --noEmit
bun run lint:fix
bun run i18n:types && node scripts/check-i18n.js
```

Expected: all tests pass; no type errors; lint clean (pre-existing warnings are fine); i18n validation passes.

---

## Self-Review

**Spec coverage** (against `2026-07-22-project-home-screen-design.md`, foundation slice):
- Route `/project/:id` inside the app shell → Task 7. ✅
- `instructions` field, minimal, identical names to sibling design → Task 1. ✅
- Chats list derivation (by `project_id` + workspace fallback, newest first) → Task 2 + Task 6. ✅
- `useProjectHome` (load, not-found, stamp `last_opened_at`) → Task 4. ✅
- New-chat scoped handoff (`navigate('/guid', { state })`) → Task 6 (`startNewChat`). ✅
- Sidebar retarget (saved → Home; legacy untouched; "+"/menu shortcut untouched) → Task 3 + Task 8. ✅
- i18n keys across all locales → Task 5. ✅
- Deferred (instructions card, files card, styled header/composer, responsive polish) → reserved slots in Task 6, called out in Scope. ✅ (intentionally out of this plan)

**Placeholder scan:** no TBD/TODO; every code step shows complete code; every test shows real assertions; commands have expected output. ✅

**Type consistency:** `ForgeProject.instructions?: string` (Task 1) is read/written consistently; `selectProjectConversations(conversations, project)` signature matches its use in `useProjectChats` (Task 6); `resolveProjectClickTarget(group)` return shape (`kind: 'home' | 'chat'`) matches its use in Task 8; `useProjectHome(id)` returns `{ project, notFound }` used identically in the page. ✅

**Known deferral (not a gap):** no automated render test for the `GroupedHistory` wiring in Task 8 — justified inline (decision logic unit-tested in Task 3; full-component render is impractical). Manual verification step included.
