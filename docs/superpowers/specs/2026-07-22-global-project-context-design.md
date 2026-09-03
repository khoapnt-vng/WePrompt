# Global (Chat) + Project Context — Design

- **Date:** 2026-07-22
- **Branch:** `feat/global-user-context` (off `weprompt`)
- **Status:** Approved design (re-scoped after spike), ready for implementation.
- **Scope:** Renderer + common only. No main-process changes, no new IPC, no Rust/AionCore change. Rides the shipped `preset_context` / `preset_rules` fallback in the pinned backend (`aioncoreVersion: v0.1.43`).

## Problem

WePrompt has no place for a user to input/store/update standing instructions. The only instruction surface today is per-**Assistant** "Rules," and system-prompt assembly lives in the external Rust backend (AionCore), consumed as a downloaded, version-pinned binary. So there is no per-user global context and no per-project context:

- A user cannot say "here's how I want the assistant to respond" once and have it apply to their chats (the Claude.ai "Instructions" model).
- A user cannot attach standing context to a body of work, even though WePrompt already has a first-class Project concept grouping conversations.

## Goals

- **Global ("Chat") instructions (per-user):** one plain-text box that conditions the user's **general/default chats** (and project chats within them).
- **Project instructions (per-project):** standing text attached to a Project, applied to new chats started in it, layered under the global instructions.
- **One composition/injection seam** shared by both tiers — designed and built once.
- No LLM calls, no Rust change, no new IPC. Ship entirely in the WePrompt TypeScript app.

## Non-goals

- **Specialized assistants are out of scope.** When a chat uses an assistant that has its own rules, the backend replaces any client-supplied context with the assistant's rules (see "Verified backend behavior"). Those chats keep the assistant's rules; the global/project context does not reach them. Confirmed acceptable with the user. (Reaching them too is the backend Path B — Future work.)
- No org-wide / seeded default context (Future work).
- No retroactive application to existing conversations; instructions apply to **new** conversations only.
- No cross-machine syncing of projects (Projects are local `localStorage` today; unchanged).
- No changes to the Assistant system, ACP protocol, or main-process message handling.

## Decisions (locked with the user)

1. **Reach (re-scoped):** the user's **general/default chats and project chats**. Specialized-assistant chats are explicitly out of scope (their rules win). The original "every chat, every assistant" ambition is dropped for this version.
2. **Path:** TS-only, via the existing `preset_context` / `preset_rules` fallback (Path A). No Rust change, single repo, no pin bump.
3. **"Chat" tier = global per-user instructions:** a single free-text box (no name/role fields) + an enable toggle. Applies across the user's chats (not a per-individual-conversation box).
4. **Project tier:** included and implemented in this branch — it reuses the shared seam.
5. **Order:** global first, then project (broad → specific) within one injected block.

## Verified backend behavior (spike, 2026-07-22)

Confirmed empirically against a running backend **and** by reading the AionCore source (`iOfficeAI/AionCore`, incl. `minhtq4/VNG_Teammate-core`; injector present at pinned `v0.1.43`):

- **The conversation's injected rules come from `rules_content`.** `aionui-conversation/src/service.rs` sets `rules_content` = the assistant's resolved rules **when the assistant has rules** (~L966–980), *overwriting* `extra.preset_context` (acp) / `preset_rules` (aionrs) and removing the other. When the assistant has **no** rules, `rules_content` falls back to the client-supplied `extra.preset_context` / `preset_rules` (~L1657).
- **Delivery to the model:** `rules_content` is injected as the first-turn `[Assistant Rules]\n…\n[/Assistant Rules]` block for acp/codex (`capability/first_message_injector.rs`), or merged into `system_prompt` for aionrs (`factory/aionrs.rs`).
- **Spike result:** with a hardcoded `WEPROMPT_CTX_OK` marker written to `extra.preset_context`/`preset_rules` at create time —
  - Chat A (default/no-rules agent) → reply began with the marker. **Our context is used.** ✅ (in scope)
  - Chat B (the "AionUi butler" assistant, which has rules) → marker absent, assistant kept its own persona. **Its rules overwrote ours.** ⛔ (out of scope, as decided)
- **Consequence:** writing `extra.preset_context` / `preset_rules` reliably reaches chats whose assistant has no rules — i.e. the general/default "New Chat" agent (the common case) and project chats. It does not reach specialized-assistant chats. This is the scope above.

## Architecture

Entirely renderer + common. Two tiers of stored text, one shared compose-and-inject seam, delivered via the conversation's `extra` (which `buildCreateConversationBody` forwards verbatim to `POST /api/conversations`).

```
 user.context (client settings) ─┐
                                  ├─► buildInjectedContext(layers) ─► extra.preset_context (acp/codex)
 ForgeProject.instructions ───────┘        (pure, ordered, trims)     extra.preset_rules   (aionrs)
        (localStorage)                                                        │
                                    (used as rules_content only when the      ▼
                                     chat's assistant has no rules)  AionCore injector → model
```

No process-boundary crossing beyond the existing HTTP client: global context persists through `configService` → `/api/settings/client`; project context is `localStorage`.

## Data model & storage

### Global ("Chat") — per-user
Add one object key to `ConfigKeyMap` in `packages/desktop/src/common/config/configKeys.ts`:

```ts
'user.context': { enabled: boolean; instructions: string } | undefined;
```

Read/write via `useConfig('user.context')` (`renderer/hooks/config/useConfig.ts`); auto-persists to the backend client-preferences bag via `/api/settings/client`. No new bridge endpoint. (`ConfigKeyMap` already carries object-valued keys such as `window.bounds`.)

Defaults: when unset, nothing is injected. On first save `enabled` defaults to `true`; empty/whitespace `instructions` injects nothing regardless of `enabled` (the toggle lets a user keep text but pause it).

### Project — per-project
Add an optional field to `ForgeProject` and its inputs in `packages/desktop/src/common/types/project/projectTypes.ts`:

```ts
export type ForgeProject = { …; instructions?: string };
export type CreateForgeProjectInput = { …; instructions?: string };
export type UpdateForgeProjectInput = { …; instructions?: string };
```

Thread through `createProject` / `updateProject` in `renderer/pages/conversation/projects/projectStorage.ts` (accept it in `isForgeProject` as an optional string), and add `findProjectById`. Storage stays `localStorage` (`forge.projects.v1`).

## Composition (shared seam — built once)

New pure module `packages/desktop/src/common/chat/buildInjectedContext.ts`:

```ts
export type ContextLayer = { label: string; text: string };
export function buildInjectedContext(layers: ContextLayer[]): string
```

- Trims each layer, drops empties, returns `''` when nothing applies.
- Joins survivors into one plain block, each under a short label, in order (global first, then project).
- No secrets, no LLM, no I/O — trivially unit-testable.

Example output (becomes the inside of AionCore's `[Assistant Rules]` wrapper):

```
[Your instructions]
<global instructions text>

[Project: Q3 HR Letters]
<project instructions text>
```

Injected block labels are **model-facing** (sent to the LLM), intentionally hardcoded English — not i18n keys.

## Injection (the one behavioral change)

A small renderer-side enrichment at the conversation-create path, **before** `ipcBridge.conversation.create.invoke(...)` (`renderer/pages/guid/hooks/resolveInjectedContext.ts`, called from `useGuidSend.ts`):

1. Read `user.context` (via `configService.get`) and, if the new conversation has a `project_id`, the project's `instructions` (via `findProjectById`).
2. `buildInjectedContext([...])` → the block.
3. If non-empty, set it into `extra` by backend: `acp`/`codex` → `extra.preset_context`; `aionrs` → `extra.preset_rules`.

`buildCreateConversationBody` (`common/adapter/apiModelMapper.ts`) stays a **pure mapper**; enrichment happens just upstream. The only create call sites are the two in `useGuidSend.ts` (aionrs + acp). `createWithConversation` (clone) is left untouched.

**On scope:** the enrichment always fires, but the backend only *uses* our value when the chat's assistant has no rules (general/default + project chats). For a specialized-assistant chat the backend overwrites it — a harmless no-op on our side, and the accepted non-goal. No client-side branch on assistant type is needed.

## UI

### Global — new "Profile" settings page
- Prepend `'profile'` to `BUILTIN_TAB_IDS` and add a `builtinMap` entry in `renderer/pages/settings/components/SettingsSider.tsx`; add the same entry to the duplicate map in `SettingsPageWrapper.tsx` (`getBuiltinSettingsNavItems`); add a `settings.groupProfile` header. Icon: `User` (`@icon-park/react`).
- Add the route `/settings/profile` in `renderer/components/layout/Router.tsx`.
- New self-contained page `renderer/pages/settings/ProfileSettings.tsx` (inside `SettingsPageWrapper`; **not** added to the already-large `SettingsModal/contents/` dir). Contents: an enable `Switch`, one instructions `Input.TextArea` (Arco — no raw HTML), and a read-only "what gets added to your chats" preview via `buildInjectedContext`.

### Project — instructions on the Project
- Add an instructions `Input.TextArea` to `renderer/pages/conversation/projects/ProjectCreateModal.tsx` (below name/workspace).
- Add an "Edit instructions" affordance in `renderer/pages/conversation/GroupedHistory/index.tsx` — mirror the existing project `rename` `Modal.confirm` handler, calling `updateProject({ id, instructions })`.

### i18n
All new labels/placeholders via i18n keys (per the `i18n` skill), across all 12 locales in `renderer/services/i18n/locales/*` (`settings.json` for Profile, `conversation.json` `history.*` for project). Run `bun run i18n:types` and `node scripts/check-i18n.js`.

## Spike — DONE (2026-07-22)

The gating spike ran (temporary hardcoded marker in `useGuidSend.ts`, reverted after) and produced the "Verified backend behavior" findings above. Verdict: **Path A works for the in-scope cases** (default/general + project chats); specialized-assistant chats are out of scope. No further backend investigation needed for this version.

## Test plan

Behavior change → focused coverage (per the `testing` skill). Vitest 4. Colocate unit tests beside source (matches `common/chat/*.test.ts`).

- `buildInjectedContext`: ordered join; whitespace-only layers dropped; all-empty → `''`.
- `resolveInjectedContext`: global-only; project-only; both (order + project name in label); disabled global toggle → global omitted (light DI for `getUserContext`/`findProject`).
- Create-path field mapping: `preset_context` for acp, `preset_rules` for aionrs (verified via the `useGuidSend` edit + `tsc`; behavior re-checked in the app).
- Storage: `user.context` round-trips through `useConfig`; `ForgeProject.instructions` round-trips through `create`/`updateProject` and survives `isForgeProject`.
- Renderer: `ProfileSettings` renders the instructions field (mock `SettingsPageWrapper`, assert by role).
- i18n: `bun run i18n:types` and `node scripts/check-i18n.js` pass across all locales.
- Full gate: `bun run test`, `bunx tsc --noEmit`, `bun run lint:fix`.

## Edge cases & fallbacks

- **No global / no project:** `buildInjectedContext` → `''`; `extra` untouched; behavior identical to today.
- **Specialized-assistant chat:** backend uses the assistant's rules; our context is dropped server-side (accepted non-goal).
- **Disabled global toggle:** global layer omitted; project still applies.
- **Very long instructions:** injected verbatim; a soft length hint may be shown (no hard cap in v1).
- **Project deleted / id stale:** project layer resolves to empty; global still applies.

## Future work (deferred)

- **Reach specialized-assistant chats (Path B).** A backend change on `VNG_Teammate-core` that appends the user's global/project context onto the resolved `rules_content` for every conversation — modeled on the existing managed-assistant `append_personal_context` (which composes `nickname`/`preferred_language`/`response_style`/`recurring_context` behind a "cannot override managed rules" notice). Requires shipping your own aioncore build + bumping the pin. The seam here makes this a delivery-mechanism swap.
- **Org-seeded default context**; **project sync** across machines.

## Risks

- **Perceived inconsistency:** the global context applies to general chats but not to specialized-assistant chats. Mitigation: clear UI copy on the Profile page ("applies to your chats; specialized assistants follow their own rules"); Path B removes the gap later.
- **First-turn injection ≠ persistent system prompt:** context lands in the first turn (acp) / merged system_prompt (aionrs), matching how assistant rules already work. Acceptable.
- **Token cost:** small per-chat addition; noted for the shared-key deployment.
- **Projects are `localStorage`-only:** per-install, not synced; consistent with the per-user global tier.
