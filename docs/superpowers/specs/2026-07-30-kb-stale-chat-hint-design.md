# KB Stale-Chat Hint

**Date:** 2026-07-30
**Decisions (user):** Case A ships as a dismissible inline notice in the conversation view with a one-click "Start new chat" action. Case B is built **only if verified genuinely stale** — otherwise nothing.
**Base:** `origin/sprint1`. **Sequencing:** the citation click-through stream also touches the conversation page — check what has merged (`git log --oneline -10 origin/sprint1`) and prefer starting after it lands; coordinate rather than racing on the same files.

## 1. The problem, precisely

A conversation's MCP server list is **frozen at creation** (verified in AionCore source: `extra.session_mcp_servers` persists at create). So a chat created while the project had **zero ready knowledge sources** never gets the `search_project_knowledge` tool — and never will, no matter how many documents are added later. The user sees the assistant claim ignorance of files that are plainly in the Knowledge card. Nothing explains why. That is **Case A**, and it is certain.

**Case B** — files added mid-chat being invisible to an already-equipped chat — is **probably not real**: dev logs show aioncore re-injecting and reconnecting the session MCP per turn (same conversation, two connects 8s apart), and the subprocess reads the store fresh at spawn. If each turn spawns fresh, mid-chat additions are searchable on the next message and a hint would be noise.

## 2. Case A — trigger, all renderer-side, zero new IPC

Show the notice when **all** hold:

1. The conversation is project-scoped (`extra.project_id` present).
2. The project currently has ≥1 source with `status === 'ready'` (existing `listSources` IPC; refresh on the `projectKnowledge.updated` emitter).
3. The conversation's persisted `extra.session_mcp_servers` does **not** include the knowledge server (match by name against `BUILTIN_KNOWLEDGE_NAME` — the constants module in `process/resources/builtinMcp/constants.ts` is Node-free; if importing it from the renderer violates a boundary rule, re-export the name via a `common/knowledge/` module rather than inlining a magic string — a duplicated literal is how the persona-label bug happened).
4. The user has not dismissed the notice for this conversation.

**Discovery step:** confirm where the conversation detail (with `extra`) is available in the conversation page/hooks; do not refetch what the page already has.

## 3. Case A — presentation

- A single-line, dismissible notice (Arco `Alert`-style, `info`/neutral tone, semantic tokens) placed near the composer in the conversation view — visible exactly where the confusion happens, not a modal, not a toast.
- Copy (en-US, keys ×12 locales): title along the lines of *"This chat can't search the project's knowledge base — it started before files were added."* + action button *"Start a new chat"*.
- **Action:** navigate to a new chat scoped to the same project — reuse the existing navigation (`navigateToProjectChat(workspace, project_id)` as used in `GroupedHistory/index.tsx:603`, or the Project Home route). Do not build a new create-chat path.
- **Dismiss** persists per conversation (`localStorage`, e.g. `kb.staleHint.dismissed.<conversationId>`). No IPC.
- The notice must never appear in: non-project chats, chats that have the KB server, projects with no ready sources, or loading states (fail closed — when in doubt, show nothing).

## 4. Case B — verify before building

Empirically, in the dev app: open a project chat **that has the tool**, add a new file to `Knowledge Base/` mid-conversation, wait for `ready`, then ask a question only the new file answers on the **next turn**.

- **New file is found** → Case B is not real. Build nothing. Record the finding (with the log lines showing per-turn reconnect) in the MR description so the question stays answered.
- **New file is not found** → Case B is real. Reuse the same notice component with different copy (*"The knowledge base changed — new chats will see the latest files."*), triggered when a `projectKnowledge.updated` event lands for this project after the conversation's `created_at`, same dismiss mechanics. Keys ×12 locales only in this branch.

Do not skip the verification and do not build B "just in case".

## 5. Files

- **New:** one notice component (conversation-page level) + a small trigger hook (`useKbStaleChatHint(conversation)`).
- **Modified:** the conversation page (mount), locales (2–3 keys ×12; more only if Case B is real), possibly a `common/knowledge/` re-export of the server name.
- **Untouched:** service, knowledgeServer, retrieval, the card, ipcBridge (zero new channels).

## 6. Tests

- Trigger-hook unit tests covering the full truth table: project/non-project × has-tool/lacks-tool × ready-sources/none × dismissed/not — exactly one cell shows the notice.
- Dismiss persistence (localStorage) and that dismissing one conversation doesn't hide another's notice.
- Action navigates with the right workspace/project args (mock navigation).
- Dom test: notice renders with i18n keys; absent in the non-trigger states.
- Live verification: create a project chat *before* adding any files, then add a file → the notice appears in that chat and a new chat searches fine; dismiss → stays dismissed across reload; the Case-B experiment from §4 with its outcome recorded.

## 7. Out of scope

Auto-migrating an old chat to gain the tool (would require rewriting persisted conversation extras — separate discussion); any change to descriptor attach logic; hints in the sidebar or Project Home; Case B beyond §4's rule.
