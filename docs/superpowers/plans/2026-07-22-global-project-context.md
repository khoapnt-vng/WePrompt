# Global + Project Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each user a global "instructions" box and per-project instructions that are automatically injected into every new conversation, layered on top of any assistant's own rules.

**Architecture:** Renderer + common only. Two stored sources — global `user.context` (backend client-settings bag) and per-project `ForgeProject.instructions` (localStorage) — are composed by one pure function and **appended** into the new conversation's `extra.preset_context` (acp/codex) / `extra.preset_rules` (aionrs). AionCore's already-shipped first-message injector (pinned `v0.1.43`) delivers it. No Rust change, no new IPC.

**Tech Stack:** TypeScript, React, `@arco-design/web-react`, `@icon-park/react`, Vitest 4, i18next (per-locale per-module JSON).

**Spec:** `docs/superpowers/specs/2026-07-22-global-project-context-design.md`

**Conventions:** Conventional Commits (`feat`/`test`/`refactor`…). NEVER add AI signatures. Colocate unit tests beside source (matches `common/chat/*.test.ts`). Arco components only — no raw `<button>`/`<input>`/`<textarea>`. All user-facing text via i18n (`i18n` skill).

---

## File Structure

**Create:**
- `packages/desktop/src/common/chat/buildInjectedContext.ts` — pure composer `(layers) => string`.
- `packages/desktop/src/common/chat/buildInjectedContext.test.ts` — composer tests.
- `packages/desktop/src/renderer/pages/guid/hooks/resolveInjectedContext.ts` — gathers global + project sources into the composed string (light DI for tests).
- `packages/desktop/src/renderer/pages/guid/hooks/resolveInjectedContext.test.ts` — resolver tests.
- `packages/desktop/src/renderer/pages/settings/ProfileSettings.tsx` — the "Profile" settings page (self-contained; no new file in the already-large `contents/` dir).

**Modify:**
- `packages/desktop/src/common/config/configKeys.ts` — add `user.context` key.
- `packages/desktop/src/common/adapter/ipcBridge.ts` — add `preset_context?` / `preset_rules?` to `ICreateConversationParams['extra']`.
- `packages/desktop/src/common/types/project/projectTypes.ts` — add `instructions?` to `ForgeProject` + inputs.
- `packages/desktop/src/renderer/pages/conversation/projects/projectStorage.ts` — thread `instructions`, add `findProjectById`, validate in `isForgeProject`.
- `packages/desktop/src/renderer/pages/guid/hooks/useGuidSend.ts` — inject at the two `conversation.create.invoke` call sites.
- `packages/desktop/src/renderer/pages/settings/components/SettingsSider.tsx` — register `profile` tab.
- `packages/desktop/src/renderer/pages/settings/components/SettingsPageWrapper.tsx` — register `profile` in the duplicate nav map.
- `packages/desktop/src/renderer/components/layout/Router.tsx` — add `/settings/profile` route.
- `packages/desktop/src/renderer/pages/conversation/projects/ProjectCreateModal.tsx` — instructions textarea.
- `packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx` — "Edit instructions" affordance.
- `packages/desktop/src/renderer/services/i18n/locales/*/settings.json` — Profile keys (12 locales).
- `packages/desktop/src/renderer/services/i18n/locales/*/conversation.json` — project-instruction keys (12 locales).

**Injected block is model-facing** (sent to the LLM, not UI chrome): its labels (`Your instructions`, `Project: <name>`) are intentionally hardcoded English and are NOT i18n keys.

---

## Task 1: Spike — prove injection works ✅ DONE (2026-07-22)

**Verdict:** injection reaches chats whose assistant has **no rules** (default/general + project chats) — confirmed by the `WEPROMPT_CTX_OK` marker appearing on the default agent. A specialized assistant (butler) overwrote it, so specialized-assistant chats are **out of scope** (accepted with the user). Spike edit reverted; tree clean. The steps below are kept as the record of what was run.

No production code ships in this task. It gates every task after it. Uses observable model behavior (no need to enable AionCore's prompt-dump).

**Files:** temporary edit to `packages/desktop/src/renderer/pages/guid/hooks/useGuidSend.ts` (reverted at the end).

- [ ] **Step 1: Add a temporary hardcoded preset to both create call sites**

In `useGuidSend.ts`, in the **aionrs** `extra` object (currently around line 202), add:

```ts
preset_rules: '[Assistant Rules]\nAlways begin your very first reply with the exact token WEPROMPT_CTX_OK.',
```

In the **acp** `extra` object (currently around line 252), add:

```ts
preset_context: '[Assistant Rules]\nAlways begin your very first reply with the exact token WEPROMPT_CTX_OK.',
```

(These fields are not yet on the `extra` type; a `// @ts-expect-error spike-only` above each line is acceptable for the spike since Task 3 adds the type.)

- [ ] **Step 2: Run the dev app**

Launch dev per the project's run flow (see the `run` skill / the `weprompt-dev-run` memory; dev needs `FORGE_` provider keys). If aioncore crashes on a migration mismatch, reset the dev DB per that memory.

- [ ] **Step 3: Verify plain chat**

Start a new chat with a plain (non-assistant) agent and send "hello".
Expected: the reply **begins with** `WEPROMPT_CTX_OK`.

- [ ] **Step 4: Verify assistant chat (no clobber)**

Start a new chat with a specialized assistant that has its own rules (e.g. a built-in assistant). Send a prompt that exercises its rules.
Expected: the reply **begins with** `WEPROMPT_CTX_OK` **and** the assistant still follows its own rules. (Confirms our block layers on top rather than replacing the assistant's rules.)

- [ ] **Step 5: Verify aionrs chat**

Start a new chat on the native `aionrs` runtime (a model-backed assistant). Send "hello".
Expected: reply begins with `WEPROMPT_CTX_OK`.

- [ ] **Step 6: Decision gate**

- All three show the token AND assistants keep their rules → proceed.
- Token missing (hook ignored) OR assistant rules disappear (clobber) → **STOP**, record what happened, and revisit the approach with the user before continuing. Optionally enable AionCore's prompt dump (`dev_prompt_dump.rs` → `data_dir/prompt-dumps`) to inspect the exact assembled prompt.

- [ ] **Step 7: Revert the temporary edit**

Remove the two hardcoded lines. Confirm `git diff` on `useGuidSend.ts` is empty.

```bash
git diff --stat packages/desktop/src/renderer/pages/guid/hooks/useGuidSend.ts
```
Expected: no output (clean).

---

## Task 2: Pure composer `buildInjectedContext`

**Files:**
- Create: `packages/desktop/src/common/chat/buildInjectedContext.ts`
- Test: `packages/desktop/src/common/chat/buildInjectedContext.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildInjectedContext } from './buildInjectedContext';

describe('buildInjectedContext', () => {
  it('returns empty string when no layers have text', () => {
    expect(buildInjectedContext([])).toBe('');
    expect(buildInjectedContext([{ label: 'A', text: '   ' }])).toBe('');
  });

  it('renders a single non-empty layer as a labelled block', () => {
    expect(buildInjectedContext([{ label: 'Your instructions', text: 'Be concise.' }])).toBe(
      '[Your instructions]\nBe concise.'
    );
  });

  it('joins multiple layers in order, trimming each, dropping empties', () => {
    const out = buildInjectedContext([
      { label: 'Your instructions', text: '  Be concise.  ' },
      { label: 'Project', text: '' },
      { label: 'Project: HR', text: 'Use formal Vietnamese.' },
    ]);
    expect(out).toBe('[Your instructions]\nBe concise.\n\n[Project: HR]\nUse formal Vietnamese.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- buildInjectedContext`
Expected: FAIL — cannot find module `./buildInjectedContext`.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** One labelled block of context to inject into a conversation's first turn. */
export type ContextLayer = {
  label: string;
  text: string;
};

/**
 * Compose ordered context layers into one plain, model-facing block.
 * Trims each layer, drops empties, returns '' when nothing survives.
 * Labels are intentionally model-facing (not i18n).
 */
export function buildInjectedContext(layers: ContextLayer[]): string {
  return layers
    .map((layer) => ({ label: layer.label.trim(), text: layer.text.trim() }))
    .filter((layer) => layer.text.length > 0)
    .map((layer) => `[${layer.label}]\n${layer.text}`)
    .join('\n\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- buildInjectedContext`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/common/chat/buildInjectedContext.ts packages/desktop/src/common/chat/buildInjectedContext.test.ts
git commit -m "feat(context): add pure buildInjectedContext composer"
```

---

## Task 3: Type additions — `user.context` key and create-params preset fields

Type-only changes; verified by the type checker.

**Files:**
- Modify: `packages/desktop/src/common/config/configKeys.ts`
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts:1621-1665` (the `ICreateConversationParams['extra']` object)

- [ ] **Step 1: Add the `user.context` key to `ConfigKeyMap`**

In `configKeys.ts`, inside the `ConfigKeyMap` type, add after the `'guid.lastAssistantId'` line:

```ts
  // Global per-user instructions injected into every new conversation.
  'user.context': { enabled: boolean; instructions: string } | undefined;
```

- [ ] **Step 2: Add preset fields to the create-conversation params `extra`**

In `ipcBridge.ts`, inside `ICreateConversationParams` → `extra`, add after the `context_handoff?: ...;` line:

```ts
    /** Global/project instructions injected as the first-turn preset context
     *  (acp/codex). Composed client-side by resolveInjectedContext. */
    preset_context?: string;
    /** Same, for the native aionrs runtime (merged into system_prompt). */
    preset_rules?: string;
```

- [ ] **Step 3: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/common/config/configKeys.ts packages/desktop/src/common/adapter/ipcBridge.ts
git commit -m "feat(context): type user.context setting and create-params preset fields"
```

---

## Task 4: Project storage — `instructions` field + `findProjectById`

**Files:**
- Modify: `packages/desktop/src/common/types/project/projectTypes.ts`
- Modify: `packages/desktop/src/renderer/pages/conversation/projects/projectStorage.ts`
- Test: `packages/desktop/src/renderer/pages/conversation/projects/projectStorage.instructions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, findProjectById, updateProject } from './projectStorage';

class MemStorage {
  private m = new Map<string, string>();
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => void this.m.set(k, v);
  removeItem = (k: string) => void this.m.delete(k);
}

describe('project instructions', () => {
  let storage: MemStorage;
  let seq: number;
  const deps = () => ({ storage, now: () => 1, createId: () => `p${++seq}` });

  beforeEach(() => {
    storage = new MemStorage();
    seq = 0;
  });

  it('persists instructions on create and finds by id', () => {
    const p = createProject({ name: 'HR', workspace: '/ws/hr', instructions: '  Be formal.  ' }, deps());
    expect(p.instructions).toBe('Be formal.');
    expect(findProjectById(p.id, [p])?.instructions).toBe('Be formal.');
  });

  it('updates instructions and clears when blank', () => {
    const p = createProject({ name: 'HR', workspace: '/ws/hr' }, deps());
    const u1 = updateProject({ id: p.id, instructions: 'Use Vietnamese.' }, { storage, now: () => 2 });
    expect(u1?.instructions).toBe('Use Vietnamese.');
    const u2 = updateProject({ id: p.id, instructions: '   ' }, { storage, now: () => 3 });
    expect(u2?.instructions).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- projectStorage.instructions`
Expected: FAIL — `findProjectById` is not exported / `instructions` not accepted.

- [ ] **Step 3: Add `instructions` to the types**

In `projectTypes.ts`:

```ts
export type ForgeProject = {
  id: string;
  name: string;
  workspace: string;
  instructions?: string;
  created_at: number;
  updated_at: number;
  last_opened_at?: number;
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
  instructions?: string;
  last_opened_at?: number;
};
```

- [ ] **Step 4: Thread `instructions` through `projectStorage.ts`**

In `isForgeProject`, add to the returned boolean chain (before the closing `)`):

```ts
    && (value.instructions === undefined || typeof value.instructions === 'string')
```

In `createProject`, extend the constructed `project` object:

```ts
  const project: ForgeProject = {
    id: createId(),
    name,
    workspace,
    ...(input.instructions?.trim() ? { instructions: input.instructions.trim() } : {}),
    created_at: timestamp,
    updated_at: timestamp,
  };
```

In `updateProject`, extend the `updated` object (after the `name` spread line):

```ts
    ...(input.instructions !== undefined
      ? { instructions: input.instructions.trim() || undefined }
      : {}),
```

Add a finder near `findProjectByWorkspace`:

```ts
export const findProjectById = (id: string, projects: ForgeProject[] = readProjects()): ForgeProject | null =>
  projects.find((project) => project.id === id) ?? null;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test -- projectStorage.instructions`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/common/types/project/projectTypes.ts packages/desktop/src/renderer/pages/conversation/projects/projectStorage.ts packages/desktop/src/renderer/pages/conversation/projects/projectStorage.instructions.test.ts
git commit -m "feat(context): store per-project instructions and add findProjectById"
```

---

## Task 5: `resolveInjectedContext` — gather global + project sources

**Files:**
- Create: `packages/desktop/src/renderer/pages/guid/hooks/resolveInjectedContext.ts`
- Test: `packages/desktop/src/renderer/pages/guid/hooks/resolveInjectedContext.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { resolveInjectedContext } from './resolveInjectedContext';

describe('resolveInjectedContext', () => {
  it('is empty when global disabled and no project text', () => {
    const out = resolveInjectedContext(undefined, {
      getUserContext: () => ({ enabled: false, instructions: 'ignored' }),
      findProject: () => null,
    });
    expect(out).toBe('');
  });

  it('includes only global when no project', () => {
    const out = resolveInjectedContext(undefined, {
      getUserContext: () => ({ enabled: true, instructions: 'Be concise.' }),
      findProject: () => null,
    });
    expect(out).toBe('[Your instructions]\nBe concise.');
  });

  it('layers global then project, using the project name in the label', () => {
    const out = resolveInjectedContext('p1', {
      getUserContext: () => ({ enabled: true, instructions: 'Be concise.' }),
      findProject: () => ({
        id: 'p1',
        name: 'HR',
        workspace: '/ws/hr',
        instructions: 'Use formal Vietnamese.',
        created_at: 0,
        updated_at: 0,
      }),
    });
    expect(out).toBe('[Your instructions]\nBe concise.\n\n[Project: HR]\nUse formal Vietnamese.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- resolveInjectedContext`
Expected: FAIL — cannot find module `./resolveInjectedContext`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildInjectedContext } from '@/common/chat/buildInjectedContext';
import type { ConfigKeyMap } from '@/common/config/configKeys';
import { configService } from '@/common/config/configService';
import type { ForgeProject } from '@/common/types/project/projectTypes';
import { findProjectById } from '@/renderer/pages/conversation/projects/projectStorage';

type ResolveDeps = {
  getUserContext?: () => ConfigKeyMap['user.context'];
  findProject?: (id: string) => ForgeProject | null;
};

/**
 * Compose the global (per-user) + project instruction layers into the
 * model-facing block appended to a new conversation's preset context.
 */
export function resolveInjectedContext(projectId?: string, deps: ResolveDeps = {}): string {
  const getUserContext = deps.getUserContext ?? (() => configService.get('user.context'));
  const findProject = deps.findProject ?? ((id: string) => findProjectById(id));

  const userContext = getUserContext();
  const globalText = userContext && userContext.enabled !== false ? userContext.instructions ?? '' : '';

  const project = projectId ? findProject(projectId) : null;
  const projectText = project?.instructions ?? '';

  return buildInjectedContext([
    { label: 'Your instructions', text: globalText },
    { label: project ? `Project: ${project.name}` : 'Project', text: projectText },
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- resolveInjectedContext`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/guid/hooks/resolveInjectedContext.ts packages/desktop/src/renderer/pages/guid/hooks/resolveInjectedContext.test.ts
git commit -m "feat(context): resolve global + project instructions into one block"
```

---

## Task 6: Wire injection into the two create call sites

Wiring task (hook internals); verified by `tsc` and re-running the Task 1 behavioral check with the real UI once Task 7 lands.

**Files:**
- Modify: `packages/desktop/src/renderer/pages/guid/hooks/useGuidSend.ts`

- [ ] **Step 1: Import the resolver**

Add near the top imports of `useGuidSend.ts`:

```ts
import { resolveInjectedContext } from './resolveInjectedContext';
```

- [ ] **Step 2: Compute the injected context once, before the aionrs/acp branch**

Immediately before `if (assistantBackend === 'aionrs') {` (around line 188), add:

```ts
    const injectedContext = resolveInjectedContext(projectId);
```

- [ ] **Step 3: Inject into the aionrs create `extra`**

In the aionrs `extra` object (around line 202), add after `project_id: projectId,`:

```ts
            ...(injectedContext ? { preset_rules: injectedContext } : {}),
```

- [ ] **Step 4: Inject into the acp create `extra`**

In the acp `extra` object (around line 252), add after `project_id: projectId,`:

```ts
          ...(injectedContext ? { preset_context: injectedContext } : {}),
```

- [ ] **Step 5: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: no new errors (fields exist from Task 3).

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/pages/guid/hooks/useGuidSend.ts
git commit -m "feat(context): inject composed context into new conversations"
```

---

## Task 7: Profile settings page + navigation + i18n

**Files:**
- Create: `packages/desktop/src/renderer/pages/settings/ProfileSettings.tsx`
- Modify: `packages/desktop/src/renderer/pages/settings/components/SettingsSider.tsx`
- Modify: `packages/desktop/src/renderer/pages/settings/components/SettingsPageWrapper.tsx`
- Modify: `packages/desktop/src/renderer/components/layout/Router.tsx`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/settings.json`
- Test: `packages/desktop/src/renderer/pages/settings/ProfileSettings.test.tsx`

- [ ] **Step 1: Add Profile i18n keys to the reference locale**

In `packages/desktop/src/renderer/services/i18n/locales/en-US/settings.json`, add:

```json
"groupProfile": "Profile",
"profile": "Profile",
"profileTitle": "Your instructions",
"profileDescription": "Tell the assistant how you'd like it to respond. These instructions are added to every new chat.",
"profileEnableLabel": "Apply my instructions to new chats",
"profileInstructionsLabel": "Instructions",
"profileInstructionsPlaceholder": "e.g. I work in HR at VNG. Prefer concise, formal Vietnamese. Ask before assuming a template.",
"profilePreviewTitle": "What gets added to your chats",
"profilePreviewEmpty": "Nothing yet — add instructions above."
```

- [ ] **Step 2: Write the failing render test**

`SettingsPageWrapper` pulls in router + layout + extension-tab hooks, so mock it to a passthrough and assert by role (translation-independent — no dependence on whether i18n is initialized in the test env):

```tsx
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

vi.mock('./components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import ProfileSettings from './ProfileSettings';

describe('ProfileSettings', () => {
  it('renders the instructions textarea', () => {
    render(<ProfileSettings />);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
});
```

(Uses the dom setup at `tests/vitest.dom.setup.ts`. `useConfig` reads the empty `configService` cache in tests, so the field renders empty — fine.)

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test -- ProfileSettings`
Expected: FAIL — cannot find module `./ProfileSettings`.

- [ ] **Step 4: Create the page**

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildInjectedContext } from '@/common/chat/buildInjectedContext';
import { useConfig } from '@/renderer/hooks/config/useConfig';
import { Input, Switch, Typography } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const ProfileSettings: React.FC = () => {
  const { t } = useTranslation();
  const [ctx, setCtx] = useConfig('user.context');
  const enabled = ctx?.enabled ?? true;
  const instructions = ctx?.instructions ?? '';

  const preview = buildInjectedContext([{ label: 'Your instructions', text: enabled ? instructions : '' }]);

  return (
    <SettingsPageWrapper>
      <div className='flex flex-col gap-24px'>
        <div className='flex flex-col gap-6px'>
          <Typography.Title heading={5} className='!mb-0'>
            {t('settings.profileTitle')}
          </Typography.Title>
          <Typography.Text type='secondary'>{t('settings.profileDescription')}</Typography.Text>
        </div>

        <label className='flex items-center gap-12px'>
          <Switch checked={enabled} onChange={(value) => void setCtx({ enabled: value, instructions })} />
          <span className='text-14px text-t-primary'>{t('settings.profileEnableLabel')}</span>
        </label>

        <label className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>{t('settings.profileInstructionsLabel')}</span>
          <Input.TextArea
            aria-label={t('settings.profileInstructionsLabel')}
            value={instructions}
            placeholder={t('settings.profileInstructionsPlaceholder')}
            onChange={(value) => void setCtx({ enabled, instructions: value })}
            autoSize={{ minRows: 6, maxRows: 16 }}
          />
        </label>

        <div className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>{t('settings.profilePreviewTitle')}</span>
          <pre className='m-0 whitespace-pre-wrap rd-8px bg-fill-2 p-12px text-13px text-t-secondary'>
            {preview || t('settings.profilePreviewEmpty')}
          </pre>
        </div>
      </div>
    </SettingsPageWrapper>
  );
};

export default ProfileSettings;
```

- [ ] **Step 5: Register the tab in `SettingsSider.tsx`**

Add `User` to the `@icon-park/react` import list. Prepend `'profile'` to `BUILTIN_TAB_IDS`:

```ts
export const BUILTIN_TAB_IDS = [
  'profile',
  'agent',
  'model',
  'skills',
  'tools',
  'appearance',
  'webui',
  'pet',
  'system',
  'about',
] as const;
```

Add a group header for it in `GROUP_HEADER_BEFORE`:

```ts
const GROUP_HEADER_BEFORE: Record<string, string> = {
  profile: 'settings.groupProfile',
  agent: 'settings.groupAiCore',
  appearance: 'settings.groupApp',
  about: 'settings.groupAbout',
};
```

Add a `profile` entry to the `builtinMap` inside the `useMemo`:

```ts
      profile: { id: 'profile', label: t('settings.profile'), icon: <User />, path: 'profile' },
```

- [ ] **Step 6: Register the tab in `SettingsPageWrapper.tsx`**

Add `User` to its `@icon-park/react` import list, and a `profile` entry to `getBuiltinSettingsNavItems`' `builtinMap`:

```ts
    profile: { id: 'profile', label: t('settings.profile'), icon: <User theme='outline' size='16' />, path: 'profile' },
```

- [ ] **Step 7: Add the route in `Router.tsx`**

Add the lazy import beside the other settings imports:

```ts
const ProfileSettings = React.lazy(() => import('@renderer/pages/settings/ProfileSettings'));
```

Add the route beside the other `/settings/*` routes:

```tsx
          <Route path='/settings/profile' element={withRouteFallback(ProfileSettings)} />
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun run test -- ProfileSettings`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/desktop/src/renderer/pages/settings/ProfileSettings.tsx packages/desktop/src/renderer/pages/settings/ProfileSettings.test.tsx packages/desktop/src/renderer/pages/settings/components/SettingsSider.tsx packages/desktop/src/renderer/pages/settings/components/SettingsPageWrapper.tsx packages/desktop/src/renderer/components/layout/Router.tsx packages/desktop/src/renderer/services/i18n/locales/en-US/settings.json
git commit -m "feat(context): add Profile settings page for global instructions"
```

---

## Task 8: ~~Project instructions UI (create + edit)~~ — REMOVED

**Owned by the Project Home branch (`feat/project-home-screen`), per cross-branch coordination.** This branch provides the project-instructions *data model* (Task 4) and *injection* (Tasks 5–6); the *editing UI* (create-modal field / history affordance / project-home right rail) lives in Project Home. Do **not** build `ProjectCreateModal` / `GroupedHistory` instruction UI here, and do **not** add `conversation.json` project-instruction i18n keys here. Skip to Task 9.

- [ ] **Step 1: Add project-instruction i18n keys (reference locale)**

In `en-US/conversation.json`, inside the `history` object, add:

```json
"projectInstructionsLabel": "Project instructions",
"projectInstructionsPlaceholder": "Standing context for chats in this project (optional)",
"editProjectInstructions": "Edit instructions",
"projectInstructionsSaved": "Project instructions updated"
```

- [ ] **Step 2: Add the instructions field to `ProjectCreateModal.tsx`**

Add state beside the existing `useState` calls:

```ts
  const [instructions, setInstructions] = useState('');
```

Reset it in the `!visible` branch of the existing `useEffect`:

```ts
      setInstructions('');
```

Pass it to `createProject` in `handleCreate`:

```ts
      const project = createProject({
        name: name.trim() || getWorkspaceBasename(workspace),
        workspace,
        instructions: instructions.trim() || undefined,
      });
```

Add a field after the folder block (before the `validationError` line), using `Input.TextArea` (import `Input` is already present):

```tsx
        <label className='flex flex-col gap-6px'>
          <span className='text-13px text-t-secondary'>{t('conversation.history.projectInstructionsLabel')}</span>
          <Input.TextArea
            aria-label={t('conversation.history.projectInstructionsLabel')}
            value={instructions}
            placeholder={t('conversation.history.projectInstructionsPlaceholder')}
            onChange={setInstructions}
            autoSize={{ minRows: 3, maxRows: 10 }}
          />
        </label>
```

- [ ] **Step 3: Add the edit affordance to `GroupedHistory/index.tsx`**

Add a handler beside `handleRenameProject` (mirrors its `Modal.confirm` shape but with a textarea and `updateProject({ id, instructions })`):

```tsx
  const handleEditProjectInstructions = useCallback(
    (projectId: string) => {
      const current = findProjectById(projectId)?.instructions ?? '';
      let next = current;
      Modal.confirm({
        title: t('conversation.history.editProjectInstructions'),
        content: (
          <Input.TextArea
            autoFocus
            defaultValue={current}
            placeholder={t('conversation.history.projectInstructionsPlaceholder')}
            autoSize={{ minRows: 4, maxRows: 12 }}
            onChange={(value) => {
              next = value;
            }}
          />
        ),
        okText: t('conversation.history.saveName'),
        cancelText: t('conversation.history.cancelEdit'),
        onOk: () => {
          updateProject({ id: projectId, instructions: next });
          refreshProjects();
          Message.success(t('conversation.history.projectInstructionsSaved'));
        },
        alignCenter: true,
        getPopupContainer: () => document.body,
      });
    },
    [refreshProjects, t]
  );
```

Ensure `findProjectById` is imported from `../projects/projectStorage` (add to the existing `updateProject`/`createProject` import from that module). Confirm `Input` and `Message` are imported from `@arco-design/web-react` (add if missing).

Add a menu item beside the existing `rename` item (search for `<Menu.Item key='rename'>`):

```tsx
                        <Menu.Item key='editInstructions'>{t('conversation.history.editProjectInstructions')}</Menu.Item>
```

Add a dispatch branch beside the existing `if (key === 'rename' ...)`:

```tsx
                      if (key === 'editInstructions' && group.project_id) {
                        handleEditProjectInstructions(group.project_id);
                      }
```

- [ ] **Step 4: Verify types + run the project storage tests**

Run: `bunx tsc --noEmit && bun run test -- projectStorage.instructions`
Expected: no type errors; storage tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/conversation/projects/ProjectCreateModal.tsx packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx packages/desktop/src/renderer/services/i18n/locales/en-US/conversation.json
git commit -m "feat(context): edit per-project instructions from create + history"
```

---

## Task 9: Fill all locales, regenerate i18n types, validate

**Files:**
- Modify: `packages/desktop/src/renderer/services/i18n/locales/{de-DE,es-ES,fa-IR,ja-JP,ko-KR,pt-BR,ru-RU,tr-TR,uk-UA,zh-CN,zh-TW}/settings.json`
- Modify: same 11 locales' `conversation.json`
- Modify: generated `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts` (via script)

- [ ] **Step 1: Add the same keys to every non-reference locale**

Follow the `i18n` skill. Add the Task 7 `settings.json` keys and Task 8 `conversation.json` `history` keys to all 11 remaining locales. Provide translations where known (e.g. `zh-CN`, `ja-JP`, `ko-KR`); the English string is an acceptable temporary fallback for locales you cannot translate, flagged for follow-up. Keep JSON valid (trailing-comma rules).

- [ ] **Step 2: Regenerate i18n types**

Run: `bun run i18n:types`
Expected: `i18n-keys.d.ts` updated with the new keys; no error.

- [ ] **Step 3: Validate i18n completeness**

Run: `node scripts/check-i18n.js`
Expected: PASS — no missing keys across locales.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/services/i18n/locales packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts
git commit -m "chore(i18n): add profile + project-instruction keys across locales"
```

---

## Task 10: Full verification gate + real-app behavioral re-check

**Files:** none (verification only).

- [ ] **Step 1: Run the full unit suite**

Run: `bun run test`
Expected: all PASS (including `buildInjectedContext`, `resolveInjectedContext`, `projectStorage.instructions`, `ProfileSettings`).

- [ ] **Step 2: Type check**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint + format**

Run: `bun run lint:fix && bun run format`
Expected: clean (judge by exit code; pre-existing warnings are fine).

- [ ] **Step 4: Real-app behavioral re-check (mirrors Task 1, now via the real UI)**

Launch dev. In Settings → **Profile**, set instructions to `Always begin your very first reply with the exact token WEPROMPT_CTX_OK.` and keep the toggle on. Create a project with instructions `Answer only in French.`
- New chat outside any project → reply begins with `WEPROMPT_CTX_OK`.
- New chat inside the project → reply begins with `WEPROMPT_CTX_OK` **and** is in French (both layers applied, order global→project).
- Toggle Profile off → new chat no longer prefixes the token.
Expected: all behaviors as described.

- [ ] **Step 5: Final commit (if lint/format changed anything)**

```bash
git add -A
git commit -m "style(context): apply lint and format fixes"
```

---

## Self-review notes (author)

- **Spec coverage:** global tier (Tasks 3,5,6,7), project tier (Tasks 4,5,6,8), shared seam (Tasks 2,5), append-not-overwrite (Task 6 uses conditional spread; the create sites carry no prior preset), spike (Task 1), i18n (Tasks 7,8,9), tests (Tasks 2,4,5,7), backend-field mapping acp/codex→`preset_context` & aionrs→`preset_rules` (Tasks 3,6).
- **Deferred per spec (not tasks):** org-seeded defaults, Path B (AionCore-native), retroactive application, project sync.
- **Type consistency:** `user.context` shape `{ enabled, instructions }` identical in `configKeys.ts` (Task 3), resolver (Task 5), page (Task 7). `ContextLayer`/`buildInjectedContext`/`resolveInjectedContext`/`findProjectById` names consistent across tasks.
- **Known pre-existing structure note:** `pages/settings/` is already above the ≤10 soft limit; per the ratchet rule we add `ProfileSettings.tsx` following the existing single-file-page pattern rather than restructuring, and we deliberately keep it out of the already-large `contents/` dir.
