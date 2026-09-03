# Project Home Screen — Designer Handoff

- **Date:** 2026-07-22
- **For:** Visual design of a new screen in **WePrompt** (Electron desktop app, fork of AionUi)
- **Companion doc:** functional spec at `docs/superpowers/specs/2026-07-22-project-home-screen-design.md` (read it for behavior/data depth; this brief is for the visual/UX design)
- **What we need from you:** hi-fi visual design of the screen and all its states, in light **and** dark, desktop **and** mobile, expressed in the app's existing design system (see [Design-system constraints](#design-system-constraints)). Layout intent and content are defined below; the visual craft is yours.

---

## 1. What this screen is

WePrompt has a first-class **Project** concept — a named workspace folder that groups a user's conversations. Today a project has **no home**: clicking it just starts a new chat. This screen gives a project a real landing page — a hub you return to — modeled on the Claude.ai "Project page."

**The user:** someone working on an ongoing body of work in WePrompt, opening one of their projects from the left sidebar. They come here to pick up where they left off, steer the project, and start new work in it.

**The job (what they should be able to do here):**
1. See and reopen the project's past **chats**.
2. Start a **new chat** already scoped to the project.
3. Read and edit the project's standing **instructions**.
4. Browse the project's **files** (its workspace folder).

**Where it lives:** a new route `/project/:id`, opened by clicking a project in the left sidebar. The app's persistent sidebar stays visible to the left; you're designing the content area.

---

## 2. Information architecture — two-column hub

Decided layout: a **two-column hub** on wide widths, collapsing to a **single column** on narrow/mobile widths.

### Desktop (wide)

```
┌ content area (sidebar is to the left, not shown) ─────────────────────┐
│ ┌───────────────────────────────────────────────────────────────────┐ │
│ │ HEADER                                                             │ │
│ │  Project name                                            [ ⋯ ]     │ │
│ │  ~/path/to/workspace · 12 chats · active 2d ago                    │ │
│ └───────────────────────────────────────────────────────────────────┘ │
│ ┌───────────────────────────────┐  ┌────────────────────────────────┐ │
│ │ MAIN COLUMN (primary)         │  │ RIGHT RAIL (secondary)         │ │
│ │ ┌───────────────────────────┐ │  │ ┌────────────────────────────┐ │ │
│ │ │ New chat                  │ │  │ │ Instructions        [Edit] │ │ │
│ │ │ [ prompt input …      ▷ ] │ │  │ │ preview of instructions…   │ │ │
│ │ └───────────────────────────┘ │  │ └────────────────────────────┘ │ │
│ │                               │  │ ┌────────────────────────────┐ │ │
│ │ Chats                         │  │ │ Files                      │ │ │
│ │  • Chat title        2d ago   │  │ │  ▸ src/                    │ │ │
│ │  • Chat title        5d ago   │  │ │  ▸ docs/                   │ │ │
│ │  • Chat title        1w ago   │  │ │    README.md               │ │ │
│ │  • …                          │  │ │  (read-only)   reveal ↗    │ │ │
│ │                               │  │ └────────────────────────────┘ │ │
│ └───────────────────────────────┘  └────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

### Mobile / narrow (single column, in this order)

```
┌─────────────────────────────┐
│ HEADER                       │
│  Project name        [ ⋯ ]   │
│  ~/path · 12 chats · 2d ago  │
├─────────────────────────────┤
│ New chat [ prompt …      ▷ ] │
├─────────────────────────────┤
│ Chats                        │
│  • Chat title        2d ago  │
│  • Chat title        5d ago  │
│  • …                         │
├─────────────────────────────┤
│ Instructions        [Edit]   │
│  preview…                    │
├─────────────────────────────┤
│ Files                        │
│  ▸ src/ ▸ docs/ README.md    │
└─────────────────────────────┘
```

Stack order on collapse: **header → new chat → chats → instructions → files** (activity first, steering below).

---

## 3. Regions — content & behavior

| Region | Content | Behavior |
|---|---|---|
| **Header** | Project name (title); subline = workspace folder path + `N chats` + last-active; overflow menu `⋯` | `⋯` opens a menu reusing existing project actions: **Rename**, **Relink folder**, **Reveal in folder**, **Remove**. (These already exist in the sidebar's project context menu — match their labels/icons.) |
| **New chat** | A prompt input with a submit affordance; label "New chat" | Submitting creates a conversation **scoped to this project** and navigates into it. *(Open question: how rich this composer is — see §7.)* |
| **Chats list** | Rows of the project's conversations, newest first. Each row: title, relative timestamp; optionally a short snippet and/or an assistant/model badge | Click a row → opens that conversation. Per-row actions (rename / delete / pin) via hover affordance or row menu — **match how conversation rows behave in the sidebar today.** |
| **Instructions card** | Collapsed: a preview (first line or two) of the project's instructions + an **Edit** control. Expanded: a multi-line text editor with **Save** / **Cancel**. A small helper note: "Applies to new chats in this project." | Edit → inline editor (or small modal — your call). Save persists the text and shows lightweight confirmation. |
| **Files card** | A **read-only** view of the project's workspace folder — files/folders, expandable. Optionally a small "context budget" label (exists today). A "Reveal in folder" affordance. | Read-only in v1: no upload/add/remove in-app. Clicking a file may open/reveal it (match the existing workspace panel). |

---

## 4. State inventory — please design each

Every state below needs a visual. Group them per region where noted.

| State | Where | What to show |
|---|---|---|
| **Loading** | Whole page | Skeleton placeholders (match the app's existing skeleton style, e.g. the new-chat page's `GuidSkeleton`). |
| **Populated** | Whole page | The normal hub with chats, instructions preview, and files (the wireframes above). |
| **Empty — no chats** | Chats list | Friendly empty state nudging "start one above." |
| **Empty — no instructions** | Instructions card | Prompt to add instructions + an add affordance. |
| **Empty — empty folder** | Files card | "This project's folder is empty." |
| **Instructions: collapsed vs editing** | Instructions card | Two visuals: preview mode and edit mode (textarea + Save/Cancel). |
| **Error — project not found** | Whole page | For a stale/deleted project id: a clear message + a way back to the app home. |
| **Error — folder missing** | Files card only | Workspace path no longer exists: "folder not found — relink" affordance; the rest of the page still works. |
| **Responsive** | Whole page | Wide (two-column) and narrow (single-column stack) versions of the populated state. |

---

## 5. Content & label inventory (draft copy — refine as you see fit)

All strings will be internationalized (the app supports multiple languages), so keep them short and translation-friendly. These are **drafts** — improve the wording:

| Key spot | Draft copy |
|---|---|
| New-chat input placeholder | "Start a new chat in this project…" |
| New-chat button / affordance | "New chat" |
| Chats section heading | "Chats" |
| Chats empty state | "No chats yet — start one above." |
| Instructions section heading | "Instructions" |
| Instructions helper note | "Applies to new chats in this project." |
| Instructions empty state | "Add instructions to steer every chat in this project." |
| Instructions edit / save / cancel | "Edit" / "Save" / "Cancel" |
| Files section heading | "Files" |
| Files empty state | "This project's folder is empty." |
| Files reveal affordance | "Reveal in folder" |
| Header meta | "{count} chats · active {relativeTime}" |
| Overflow menu items | "Rename" / "Relink folder" / "Reveal in folder" / "Remove" |
| Project not found | "Project not found." + "Back to home" |
| Folder missing | "Folder not found." + "Relink folder" |

---

## 6. Interaction & motion notes

- **Primary action** is starting/continuing work: the new-chat region and chats list are the emphasis; instructions + files are supporting.
- **Instructions edit**: prefer an inline expand (preview → editor in place) over a full-page context switch; show a subtle saved confirmation.
- **Row hover**: chat rows reveal their actions on hover (desktop) / via a row menu (touch), consistent with the sidebar.
- **Navigation**: opening a chat or starting a new one leaves this page; browser/app back returns to it.
- Keep motion **restrained and consistent** with the rest of the app — this is a utilitarian workspace, not a marketing page.

---

## 7. Open design questions (your call — flag your recommendation)

1. **New-chat composer richness.** Lightweight single prompt box, or a fuller composer that mirrors the app's main new-chat screen (inline model + assistant selectors)? Trade-off: quick-to-scan vs. power/consistency with the main composer.
2. **Right-rail balance.** How to keep instructions glanceable without the rail feeling cramped when instructions get long (preview length, "show more," scroll).
3. **Chat row density.** Title-only vs. title + snippet + badge; how many rows before "show all" / scroll.
4. **Files card depth.** Full tree vs. shallow list; how much folder depth to show by default in a secondary card.
5. **Header meta placement.** Inline subline vs. tucking some of it into the `⋯` menu.

---

## 8. Design-system constraints

The screen must be implementable in the app's existing stack — please design **within** these, not around them:

- **Component library: Arco Design** (`@arco-design/web-react`). Use Arco components — Button, Input / Input.Search, `TextArea`, List, Card, Dropdown / Menu, Skeleton, Empty, Message (toast), etc. **No custom/raw interactive HTML** (no bare `<button>`, `<input>`, `<select>`). If you design a control, map it to an Arco component.
- **Icons:** `@icon-park/react` (icon-park). Pick icons from that set.
- **Color:** use the app's **semantic tokens** (CSS variables / UnoCSS theme) — no hardcoded hex. The brand/accent color is **Forge orange `#F05A22`** (already the Arco primary). Backgrounds/text/borders come from semantic tokens (`bg-*`, `text-t-primary`, `text-t-secondary`, etc.).
- **Theming: must work in both light and dark.** Provide both.
- **Layout:** UnoCSS utility classes for layout; CSS Modules for anything complex. The app is **mobile-aware** — design the responsive collapse.
- **Density & tone:** a focused desktop productivity tool. Match the visual weight of the existing screens below.

### Reference screens to match (open the app to see them)

- **New-chat / "Guid" screen** — the app's landing/new-chat composer. Match its input card, model/assistant selectors, and skeleton loading style.
- **Left sidebar (project list)** — projects and their context menus, conversation rows. Match row styling and the project `⋯` menu (Rename/Relink/Reveal/Remove).
- **Conversation screen + Workspace panel** — the right-side file explorer. Reuse its file-tree visual language for the Files card.

The new Project Home should feel like it has always been part of the app — same spacing scale, same card and list treatments, same iconography.

---

## 9. Out of scope (don't design these)

- In-app file upload / add / remove (files card is read-only; managing files happens in the folder).
- Project **creation** (stays in the existing sidebar "new project" modal).
- An app-level "all projects" dashboard/launcher (separate, deferred).
- Team/shared projects, cross-machine sync, analytics/activity charts.
- The mechanics of how instructions reach the model (handled elsewhere in code) — you only design the **editing surface**.

---

## 10. Deliverables requested

- Hi-fi mockups of the **populated** state, **light + dark**, **desktop + mobile**.
- The **states** in §4 (loading, empties, instructions edit, not-found, folder-missing).
- Any component mapping notes (which Arco component each element maps to) and token usage.
- Your recommendations on the open questions in §7.

Questions or missing context: ping the WePrompt maintainer and reference this brief + the companion functional spec.
