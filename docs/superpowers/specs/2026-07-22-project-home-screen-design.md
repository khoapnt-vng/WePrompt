# Project Home Screen — Design

- **Date:** 2026-07-22
- **Branch:** `feat/project-home-screen` (off `weprompt`)
- **Status:** Approved design, ready for implementation planning
- **Scope:** Renderer only. No main-process changes, no new IPC, no Rust/AionCore change. Reuses existing project storage (`localStorage forge.projects.v1`), the conversation-history context, the workspace file-explorer, and the existing project-scoped new-chat flow.

## Problem

A "Project" in WePrompt (`ForgeProject`) is a first-class concept that groups conversations under a named workspace folder, but it has **no home**. Clicking a project in the sidebar today just runs `navigate('/guid', { workspace, projectId })` — it dumps the user straight into a *new scoped chat*. There is nowhere to:

- return to a project and see its existing conversations in one place (they are only scattered through the sidebar timeline),
- read or set standing instructions for the project,
- see the files the project's assistant can draw on.

A project is therefore a folder you start chats *from*, not a workspace you come back *to*. This screen fills that hole with a per-project overview page, following the Claude.ai "Project page" model the team is already aligned on.

## Goals

- A per-project overview page at a new route `/project/:id` that a user lands on when they open a project.
- Surface, on one screen, the four things a user does with a project: **see & reopen its chats**, **start a new chat in it**, **view/edit its instructions**, and **browse its files**.
- Reuse existing building blocks (project storage, conversation history, workspace explorer, scoped new-chat) rather than re-implementing them.
- Keep the branch **shippable and testable standalone**, coordinating cleanly with the per-project *instructions* data/injection work happening on `feat/global-user-context`.

## Non-goals

- **Prompt injection** of the instructions text (feeding it to the model) — that is owned by `feat/global-user-context` via the `preset_context`/`preset_rules` seam. Project Home only edits the *stored* text.
- **Global user context** — sibling branch.
- In-app file **add/remove/upload** — managing knowledge means using the workspace folder directly (with a "reveal in folder" affordance). Read-only browse only in v1.
- Project **creation** — stays in the existing sidebar `ProjectCreateModal`.
- In-page project search/filter, team/shared projects, cross-machine sync, activity charts/analytics.
- No main-process changes, no new IPC, no AionCore/Rust change.

## Decisions (locked with the user)

1. **Screen role:** a **per-project overview page** (Claude.ai Project-page style), not an app-level projects launcher.
2. **Capabilities (all four):** see & reopen chats; start a new chat scoped to the project; view/edit project instructions; browse project files.
3. **Instructions surface ownership:** **Home owns the view+edit UI.** The sibling branch keeps the data model, storage threading, injection seam, and global context, and **drops** its planned sidebar "edit instructions" modal.
4. **Sidebar entry:** clicking a project **opens its Home page**. Starting a chat is one click from Home; the sidebar's per-project "New chat" context-menu item stays as a direct shortcut.
5. **Layout:** **two-column hub** (main column = new-chat + chats; right rail = instructions + files), degrading to a single column on narrow/mobile widths.
6. **Files card:** **read-only browse** in v1.
7. **New-chat behavior fixed** (routes through the existing scoped-create path); composer *visual richness* (whether the model/assistant selector row appears inline) is left to the designer, defaulting to a lightweight prompt box.
8. **Coordination default:** this branch defines the *minimal* `instructions?: string` field it needs itself (see Cross-branch coordination), using the exact names from the sibling design, so it stays standalone and merges trivially.

## Verified current-state facts

From renderer exploration (paths relative to repo root):

- **Project entity `ForgeProject`** — `packages/desktop/src/common/types/project/projectTypes.ts`: `id`, `name`, `workspace` (absolute folder path), `created_at`, `updated_at`, `last_opened_at?`. No description/instructions/knowledge field today. `ProjectConversationExtra` (`project_id?`, `workspace?`, `custom_workspace?`) links a conversation to a project.
- **Storage/CRUD** — `packages/desktop/src/renderer/pages/conversation/projects/projectStorage.ts`: `localStorage` key `forge.projects.v1`; `readProjects`, `updateProject`, etc. Sorted by `last_opened_at ?? updated_at` desc.
- **Change events** — `projects/projectEvents.ts` dispatches a `forge:projects-changed` window event; `projects/useProjects.ts` subscribes (plus `storage` events) for cross-window sync.
- **Conversation↔project resolution** — `projects/projectConversation.ts::resolveConversationProject()` (via `extra.project_id`, then `extra.workspace`).
- **No project page today** — the whole project UX lives in the sidebar `packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx`. `navigateToProjectChat` → `navigate('/guid', { state: { workspace, projectId } })`. Per-project context menu already wires rename (`updateProject`), reveal-in-folder, relink-folder, remove.
- **Routing** — `packages/desktop/src/renderer/components/layout/Router.tsx`: `HashRouter`, all pages `React.lazy`, gated by `ProtectedLayout`, rendered inside the `Layout` shell (with `Sider`). App lands on `/guid`.
- **App home / new-chat** — `packages/desktop/src/renderer/pages/guid/` (`GuidPage.tsx`, `hooks/useGuidSend.ts` creates the conversation and stamps `extra.project_id/workspace`, `components/GuidInputCard.tsx`, model/assistant selectors, `GuidSkeleton.tsx`).
- **Workspace file-explorer** — `packages/desktop/src/renderer/pages/conversation/Workspace/index.tsx` (reusable for the files card; also has `getProjectContextBudgetLabel`).
- **Instructions data model is NOT built yet** — `feat/global-user-context` and `feat/project-home-screen` currently point to the same commit; the two-tier context feature exists only as a design doc (`docs/superpowers/specs/2026-07-22-global-project-context-design.md`).
- **UI stack** — `@arco-design/web-react` (Arco, primary `#F05A22`), `@icon-park/react`, UnoCSS, CSS Modules, `react-i18next`. Layout shell `components/layout/Layout.tsx` is mobile-aware via `LayoutContext.isMobile`.

## Architecture

Renderer-only. A new lazy route `/project/:id` renders a page that composes four regions from existing data sources; no data need crosses the process boundary beyond bridges already in use.

```
/project/:id ─► useProjectHome(id) ─► readProjects().find(id) ─► project | null
                                            │
   ┌────────────────────────────────────────┼───────────────────────────────┐
   ▼                     ▼                    ▼                                ▼
useProjectChats      project.instructions   project.workspace          settings menu
(conversation-       (edit → updateProject   (workspace file-explorer)  (rename/relink/
 history ctx,         → forge:projects-                                  remove — reuse
 filter by            changed event)                                     existing actions)
 resolveConversationProject)
```

### Routing & navigation

- Add `/project/:id` to `Router.tsx` as a lazy page inside `ProtectedLayout` + `Layout` (sidebar stays visible, consistent with `/guid` and `/conversation/:id`).
- In `GroupedHistory/index.tsx`, retarget the project click (`navigateToProjectChat`) to `navigate('/project/:id')` instead of `/guid`.
- Keep the per-project context-menu **"New chat"** item on its current behavior (`navigate('/guid', { workspace, projectId })`) as the direct shortcut.
- Stamp `last_opened_at` (via `updateProject`) when Home opens, preserving today's "opening a project bumps it to the top" behavior.
- **Legacy workspace groups** (folders with chats but no saved `ForgeProject`, `source: 'legacy-workspace'`) have no `id`, so they get no Home page — clicking them keeps today's behavior. Converting one to a project (existing flow) then gives it a Home.
- Flows out of Home: open a chat → `/conversation/:id`; new chat → scoped `/guid` flow → `/conversation/:id`. Router back returns to Home. `/project/:id` is a normal, deep-linkable hash route.

## Page layout & content (two-column hub)

**Header (full width)** — project name as title; subtle subline with the workspace folder path + `N chats · last active <date>`; a settings/overflow (⋯) menu reusing the sidebar's existing actions (rename, relink folder, reveal in folder, remove).

**Main column (primary)**
- **New-chat region (top):** a prompt input + "New chat" action that creates a conversation scoped to this project through the existing scoped-create path (`extra.project_id`/`workspace`). Behavior fixed; composer richness is a designer polish call (default: lightweight prompt box).
- **Chats list (body):** the project's conversations, newest first. Row = title, timestamp/snippet, optional assistant/model badge; click → `/conversation/:id`; per-row actions (rename/delete/pin) reuse existing conversation-item actions. Empty state: "No chats yet — start one above."

**Right rail (secondary)**
- **Instructions card** *(this branch owns it):* collapsed = preview + "Edit"; expanded = Arco `TextArea` with save/cancel, writing via `updateProject({ id, instructions })`. Empty state: "Add instructions to steer every chat in this project." Small "applies to new chats" note matching the injection contract.
- **Files / knowledge card:** read-only browse of the workspace folder, reusing the workspace file-explorer. Optionally surface the existing `getProjectContextBudgetLabel`. Empty state: "This project's folder is empty." "Reveal in folder" affordance; no in-app add/remove in v1.

**States (whole page)**
- **Loading:** skeletons mirroring the `GuidSkeleton` pattern.
- **Project not found** (stale/bad `:id`, deleted project): friendly message + link back to `/guid`.
- **Folder missing/moved:** files card shows "folder not found — relink" (reuses relink); chats + instructions still work.
- **Responsive:** two columns on wide widths; below the breakpoint the right-rail cards drop **below** the chats list (instructions first, then files), driven by `LayoutContext.isMobile`.

## Component decomposition & file placement

New page directory `packages/desktop/src/renderer/pages/project/` (mirrors `pages/guid/`; consumes the existing project storage/logic in `pages/conversation/projects/`):

- `index.tsx` — lazy route export (guid pattern)
- `ProjectHomePage.tsx` — thin orchestrator: resolve `:id`, load project, render two-column layout, handle loading / not-found
- `ProjectHomePage.module.css` — responsive two-column grid
- `components/`
  - `ProjectHeader.tsx` — name, folder path, meta, settings menu
  - `ProjectNewChat.tsx` — new-chat entry (hands off to scoped-create)
  - `ProjectChatList.tsx` — chats rows + per-row actions + empty state
  - `ProjectInstructionsCard.tsx` — instructions view/edit (owned section)
  - `ProjectFilesCard.tsx` — wraps the workspace file-explorer
- `hooks/`
  - `useProjectHome.ts` — load `ForgeProject` by id, not-found, stamp `last_opened_at`
  - `useProjectChats.ts` — derive this project's conversations from the history context

All directories stay ≤10 children. File placement is provisional; the implementation plan runs it against the `architecture` skill.

**Reuse (no re-implementation):** `projectStorage.ts` (`readProjects`/`updateProject`); `resolveConversationProject()` + conversation-history context; the existing scoped new-chat flow; the workspace file-explorer; existing conversation-row actions.

## Cross-branch coordination (instructions)

- Project Home **edits stored `instructions` text only**; it does **not** implement injection. Making instructions reach the model stays with `feat/global-user-context`.
- **Recommended default (locked):** this branch defines the minimal piece it needs — `instructions?: string` on `ForgeProject`, passthrough in `updateProject`, and acceptance in `isForgeProject` validation — using the **exact names from the sibling design doc**. This keeps the branch shippable/testable standalone; the merge with `feat/global-user-context` is a trivial identical-field reconciliation, not a blocker.
- **Consequence to accept:** if Project Home merges first, editing instructions persists the text but has **no runtime effect** until the sibling branch lands injection. The sibling branch also drops its planned sidebar "edit instructions" modal (Home is that surface now).

## Error handling & edge cases

- **Project not found:** dedicated state + link back to `/guid`.
- **Workspace folder missing/moved:** files card → "folder not found — relink" (reuse relink); rest of page functions.
- **Empty states:** no chats / no instructions / empty folder each have copy.
- **Instructions field absent** (e.g. if the minimal field weren't defined): the card must degrade gracefully (hide / "coming soon") rather than crash. Mitigated by the coordination default.
- **Corrupt/failed `localStorage` read:** `projectStorage` already validates via `isForgeProject`; treat unresolved as not-found.
- **Long instructions:** no hard cap in v1 (matches the sibling design); optional soft hint.
- **Concurrent edits across windows:** `forge:projects-changed` + `storage` events already keep views in sync; last-write-wins on save.

## Test plan

Vitest 4, per the `testing` skill. Focused coverage for changed behavior:

- `useProjectHome`: resolves by id; not-found for bad/stale id; stamps `last_opened_at`.
- `useProjectChats`: filters conversations to the project via `resolveConversationProject` (both `project_id` and `workspace`-fallback cases); excludes others; sort order.
- `ProjectInstructionsCard`: renders preview / empty; edit → save calls `updateProject` with `instructions`; cancel discards.
- `ProjectChatList`: renders rows; empty state; row click navigates; row actions.
- Navigation: sidebar project click routes to `/project/:id`; menu "New chat" still scoped-create; legacy workspace groups unaffected.
- New-chat: submitting creates a conversation scoped to the project (`extra.project_id`/`workspace`).
- Not-found and folder-missing states render.
- Full gate: `bun run test`, `bunx tsc --noEmit`, `bun run lint:fix`; plus `bun run i18n:types` and `node scripts/check-i18n.js`.

## i18n

All new labels/placeholders/empty-states/menu items use i18n keys (per the `i18n` skill), added across every locale for the project-home module. Run `bun run i18n:types` and `node scripts/check-i18n.js`.

## Future work (deferred)

- Prompt injection wiring lands with `feat/global-user-context` (merge coordination).
- In-app file management (upload/add/remove) for the knowledge card.
- In-page search/filter across a project's chats.
- App-level projects launcher/dashboard (the "list all projects" screen we explicitly deferred).
- Team/shared projects, cross-machine sync, activity/analytics.

## Risks

- **Cross-branch field duplication.** Both branches touch `ForgeProject`/`projectStorage`. Mitigated by using identical names so the conflict (if any) is a trivial identical-line reconciliation.
- **New-chat reuse coupling.** The scoped-create flow currently lives with the Guid page; extracting/reusing it cleanly (vs. duplicating) needs care in the plan so behavior can't diverge.
- **Right-rail cramping.** Long instructions in a narrow rail; mitigated by "preview → expand to edit" and the responsive single-column collapse.

## Design resolution (hi-fi mockup, 2026-07-22)

The designer delivered a hi-fi mockup (saved at `docs/superpowers/specs/2026-07-22-project-home-screen-design-mockup.html` — a self-unpacking bundled page; open in a browser to view). It covers desktop light/dark, mobile single-column, and the full §4 state inventory, and resolves the open questions. **This section supersedes the "deferred to designer" notes above.** Scope is now the full screen, not a foundation shell.

**Resolved open questions:**
1. **Composer — full.** `Input.TextArea` (autosize) in a `Card` with **inline model + assistant `Select`s** and a primary submit `Button`, mirroring the main new-chat screen. Placeholder: "Start a new chat in this project…".
2. **Right-rail balance.** Instructions preview clamps to ~2 lines + ellipsis (full text in the editor). Files card caps height and scrolls — the rail never grows unbounded.
3. **Chat rows.** Icon avatar + title + one-line snippet + relative time; hover reveals pin / rename / delete. ~5 rows, then a "Show all" affordance. Count badge next to the "Chats" heading.
4. **Files — shallow.** Top-level folders/files, expand on click (a secondary card, NOT the full workspace panel). "Reveal in folder" opens the OS folder. "Read-only · manage in the folder" note. Context-budget label ("context N%").
5. **Header meta — inline subline.** `name` on top; subline `path · N chats · active <relative>`; rare/destructive actions (Rename / Relink / Reveal / Remove) in a `⋯` `Dropdown`+`Menu` reusing the sidebar project menu.
6. **Instructions edit — inline expand.** Preview → in-place `Input.TextArea` (orange focus ring), Save/Cancel `Button`s, then a lightweight "Instructions saved" `Message` — no page switch.

**Component & token mapping (designer's note):**

| Region | Arco components |
| --- | --- |
| Header + ⋯ menu | `Dropdown` + `Menu` (items = sidebar project menu: Rename / Relink / Reveal / Remove) |
| New-chat composer | `Input.TextArea` (autosize) in a `Card`; model/assistant = `Select`; submit = primary `Button` |
| Chats list | `List` rows; hover actions = text `Button`; empty = `Empty` |
| Instructions | `Card` → inline `Input.TextArea` + Save/Cancel `Button`s; confirm via `Message` |
| Files | `Tree` (read-only) reusing the workspace panel's icons; missing folder = `Alert` |
| Loading | `Skeleton` (matches the new-chat `GuidSkeleton`) |

Tokens: surfaces `bg-*`, text `text-t-primary` / `text-t-secondary`, accent = Arco primary `#F05A22`. Both themes flip via the theme attribute — no per-component theming work.

**Full §4 state inventory (exact copy to implement):**

- **Loading** — skeleton matching `GuidSkeleton`.
- **Populated** — desktop (two-column) and mobile (single-column: header → new chat → chats → instructions → files).
- **Instructions editing** — textarea + Cancel/Save; on save show `Message` "Instructions saved".
- **Empty — no chats** — "No chats yet" / "Start one above to begin working in this project." + a "New chat" action.
- **Empty — no instructions** — "Add instructions to steer every chat in this project." + "Add instructions".
- **Empty — empty folder** — "This project's folder is empty."
- **Error — folder missing** (files card only) — `Alert`: "Folder not found" / `<path>` / "Relink folder"; note "The rest of the page still works."
- **Error — project not found** (whole page) — "Project not found" / "This project may have been removed or its link is out of date." / "Back to home".
