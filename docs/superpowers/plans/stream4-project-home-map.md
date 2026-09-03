# Stream 4 map (verified at e1a0cb93a)

> **How to use this.** A structural map of the project-home components, produced by three
> parallel readers against a clean worktree at `e1a0cb93a`. Pair it with the Stream 4
> section of `ui-improvements-streams.md`: that has the findings and acceptance criteria,
> this has where each one lands, what to reuse, and what breaks if you edit naively.
>
> **Finding #1 is DONE** — shipped from branch `feat/ui-project-home` (commit
> `cac76a4ff`): toasts on every knowledge failure path, the hook's mutators refetching in
> `finally` and rethrowing, seven new locale strings, and the Arco `Message` stub its test
> needed. Skip #1.
>
> **Ten findings remain: #2, #3, #4, #6, #7, #8, #9, #10, #11, #12.** (#5 is void — the
> kb-ui-polish rewrite already implemented drag-and-drop; do not redo it.)
>
> **Two hard blockers to settle before touching those**, both in
> `tests/unit/pages/project/ProjectHeader.dom.test.tsx` and both detailed under Hazards:
> - #8's declarative-Modal route — the test mocks Arco as
>   `Modal: { ...actual.Modal, confirm }`, and spreading a React component drops its statics.
> - #3's remove fix — the test does not mock `projectStorage`, so `removeProject` runs for
>   real against jsdom localStorage.
>
> **Read the Hazards sections before editing.** They name six load-bearing tests, the Arco
> `Message` legacy-render trap (all three test files), Arco portalling, and which apparent
> "problems" are deliberate and must not be "fixed".
>
> ## Corrections from an independent re-verification (accepted, and re-checked here)
>
> A second session re-verified this stream at `bf75fc373`. I confirmed each claim against
> the code rather than taking it on trust; all four hold, with two refinements.
>
> 1. **#4 and #7: do NOT implement the prescribed focus ring / key handler as written.**
>    Both routes the findings offer (`outline-1`-style utilities, `focus-visible:bg-fill-*`)
>    are no-ops in this theme — they pass lint, tsc and jsdom and fail only by eye. Use
>    `ROW_FOCUS_RING` and `activateOnEnterOrSpace` from
>    `renderer/utils/ui/rowActivation.ts`, or a real `.row:focus-visible` rule in
>    `ProjectChatList.module.css`. The helper's own doc comment explains why.
>
> 2. **NEW FINDING — two card footers have an invisible hairline in dark.** A *second*
>    token with the same defect as the escalated `--bg-3`, which that escalation never
>    names: `--border-light` is `#eceef1` light but **`#1e2536`** dark
>    (`default-color-scheme.css:57` / `:141`), byte-identical to `--dialog-fill-0` (`:158`),
>    which is the Arco `Card` surface these sit on. Verified affected:
>    - `ProjectKnowledgeCard.tsx:502` — inside the `<Card>` at `:412`
>      (the other session cited `:453`, correct at `bf75fc373`; finding #1's commit shifted it)
>    - `ProjectFilesCard.tsx:100` — inside the `<Card>` at `:53`
>
>    Verified **safe, do not touch**: `ProjectHeader.tsx:169` — the page shell is
>    `--bg-chat-surface` (`ProjectHomePage.module.css:17`), which is `#0b0e14` in dark, so
>    the hairline reads there. Fix with `border-t-4` / the `--bg-4` step, matching Stream 1.
>
>    ⚠️ **Beware the grep.** The utility is `border-t-light`, so a search for the literal
>    `border-light` finds **none** of these — it only hits `--border-light` token
>    definitions in CSS. Use `grep -rnE "border-(t|b|l|r|x|y)-light\b"`.
>
> 3. **#8 and #3 need far fewer new locale keys than the findings assume.** Verified present
>    in **all 12** locales under `conversation.history`: `renamePlaceholder`
>    ("Please enter a new name"), `renameSuccess`, `renameFailed`, `deleteSuccess`,
>    `deleteFailed`. Reuse them rather than minting `projectHome.*` twins. Whether a project
>    rename should read differently from a chat rename is a copy call, not a technical one.
>
> 4. **`KnowledgeSourcePreview.tsx` is in the owns-glob but is NOT yours alone** —
>    `pages/conversation/knowledge/KnowledgeCitationsContext.tsx` imports it and renders it
>    for the chat citation drawer. Changing its prop contract breaks chat-side citations,
>    which this stream does not own. No finding needs it edited; keep it that way. (This
>    corroborates a hazard already listed below.)
>
> Minor drift also confirmed: `ipcBridge` `openFile` is `:177` and `showItemInFolder` `:178`;
> `isMissingVectors` is lines 38-39.
>
> ### One site the re-verification missed, outside this stream — now handed to Stream 5
>
> The same defect also exists at `components/settings/DirectorySelectionModal.tsx:192` and
> `:210` — **Stream 5's file**. Rather than open a competing branch, it has been written
> into Stream 5's finding #4 in `ui-improvements-streams.md`, because that finding already
> makes those exact rows keyboard-reachable: one visit to the rows instead of two MRs
> touching the same lines. Nothing to do here.
>
> Conventions that constrain any fix, already validated in Streams 1–2: Arco components
> only; `@icon-park/react` icons; semantic UnoCSS tokens only; all user-facing text via
> i18n across 12 locales; deletes are red/`status:'danger'`; in dark mode `--bg-3` equals
> `--dialog-fill-0` so use `border-4`; numeric Uno utilities are hijacked into colours
> (`outline-1` sets a colour, not a width) so declare outlines as one arbitrary property.

## packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx (+ packages/desktop/src/renderer/pages/project/hooks/useProjectKnowledge.ts)
**Summary:** ProjectKnowledgeCard.tsx (498 lines) is an Arco `Card` rendering the project's `Knowledge Base/` folder as a flat list. Structure as it stands after kb-ui-polish: module-level helpers `isPreviewable` (=== 'ready') at :32, `isMissingVectors` (ready && vectorCount < chunkCount) at :38, `isSupportedFile` at :41, `PreviewState`/`EMPTY_PREVIEW` at :46-54. Component body: `useTranslation` at :71, `useProjectKnowledge(project)` destructured at :73-84, local `preview` + `dragging` state at :85-86, `busy` guard at :94. Handlers: `handleAdd` :96, `handleEmbedAll` :115, `handleRelink` :126, `handlePreview` :141, `pathsFromDrop` :155, `handleDrop` :175, `handleDragOver` :188, `handleDragLeave` :195. Renderers: `progressLabel` :211, `renderOcrTag` :223, `renderStatus` :243 (switch on status: indexing / ready→[progress tag | missing-vectors Retry | null] / failed / unsupported), `renderRowTooltip` :313, `renderRow` :321. JSX: Card :369 with drag handlers :377-379 and header `extra` actions (reveal :384, refresh :396, add :405), body branching loading/error/list :415-481, footer note block :452-479, and `KnowledgeSourcePreview` drawer :482-492. `t()` IS in scope in the card (react-i18next imported at :16). useProjectKnowledge.ts (126 lines) is a plain data hook: `refetch` :43, mount effect (refetch + fire-and-forget syncFolder + `updated` subscription) :58-71, `addSources` :73, `removeSource` :81, `retrySource` :89, `syncNow` :97 (the only one with try/finally), `getSourceText` :107. The hook has NO react-i18next and NO Arco import — `t()` is NOT in scope there and it renders nothing, so all toast/i18n work belongs in the card.

**Reuse these in-file patterns:**
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:78-83 — console.error + Message.error(t('...Failed')) side by side; the exact toast pattern to copy for #1
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:140-151 — delete flow: Message.success on success, Message.error on both !success and throw
- packages/desktop/src/renderer/pages/project/components/ProjectInstructionsCard.tsx:50 — Message.success(t('conversation.projectHome.instructionsSaved')) — the projectHome namespace already has a success-toast key precedent
- packages/desktop/src/renderer/pages/conversation/projects/ProjectCreateModal.tsx:81,85 — Message.success / Message.error pairing
- packages/desktop/src/renderer/utils/ui/rowActivation.ts:17,44 — activateOnEnterOrSpace + ROW_FOCUS_RING; REUSE for #4, do not inline a keydown handler
- packages/desktop/src/renderer/components/layout/Sider/SiderItem.tsx:60-74 — canonical role='button'/tabIndex/aria-label/onKeyDown/ROW_FOCUS_RING application on a non-button div
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:277-296 — Tag + Tooltip + Retry trio; the in-file shape for #6
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:223-241 — Tooltip-wrapped Tag with interpolated i18n detail
- packages/desktop/src/renderer/pages/project/hooks/useProjectKnowledge.ts:97-105 — try/finally + refetch-on-failure; the in-file shape for the #1 hook change
- packages/desktop/src/renderer/pages/settings/AssistantSettings/DeleteAssistantModal.tsx:31 — okButtonProps={{ status: 'danger' }} on a destructive confirm
- i18n: keys live under the `projectHome` object (packages/desktop/src/renderer/services/i18n/locales/en-US/conversation.json:40 opens it; the ~30 existing knowledge* keys are at :72-101) and must be added to all 12 locale dirs: de-DE, en-US, es-ES, fa-IR, ja-JP, ko-KR, pt-BR, ru-RU, tr-TR, uk-UA, zh-CN, zh-TW

### Findings

#### #1 — still_valid=True | t_in_scope=True
**Where:**
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:104 — handleAdd catch: console.error only
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:120 — handleEmbedAll per-source catch: console.error only
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:136 — handleRelink catch: console.error only
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:183 — handleDrop catch: console.error only
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:180 — handleDrop silently returns when every dropped file was filtered out by isSupportedFile (:170); dropping only a .zip gives ZERO feedback
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:178 — handleDrop silently returns when folderMissing
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:266 and :290 — row Retry buttons call `void retrySource(source.id)` with no catch at all (unhandled rejection, no toast)
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:353 — Popconfirm onOk `void removeSource(source.id)`: no catch; a trashItem failure (projectKnowledgeService.ts:870-871 throws) leaves the row and says nothing
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:400 — Refresh `void syncNow()`: no catch
- packages/desktop/src/renderer/pages/project/hooks/useProjectKnowledge.ts:73-79 addSources, :81-87 removeSource, :89-95 retrySource — `await invoke(...)` then `await refetch()` with no try/finally, so a rejected invoke ALSO skips the refetch and leaves the list stale
- packages/desktop/src/renderer/pages/project/hooks/useProjectKnowledge.ts:97-105 — syncNow's try/finally is the in-file pattern to copy (comment explains why refetch must run even on failure)
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:12 — Arco import line; `Message` is NOT yet imported

**Fix:** Two-part, and keep i18n out of the hook. (a) Hook: wrap the three mutators' invoke in try/finally with `await refetch()` in the finally and let the error propagate (rethrow) — mirror syncNow at :97-105 exactly; do NOT swallow, the card needs the rejection. (b) Card: add `Message` to the existing `@arco-design/web-react` import at :12, then replace every bare `console.error` / `void x()` with a try/catch that keeps the console.error AND calls `Message.error(t(...))` — handleAdd :104, handleEmbedAll :120 (toast once after the loop, not per source, or the user gets N toasts), handleRelink :136, handleDrop :183, and wrap the three fire-and-forget call sites (:266, :290, :353, :400) in small async handlers with try/catch. Add a `Message.warning` for the two silent drop returns (:178 folderMissing, :180 nothing supported). Optionally a `Message.success` on delete to match ProjectChatList.tsx:144. Sibling pattern to copy verbatim: packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:78-83 and :140-151 (console.error + Message.error side by side).

**Keys:** conversation.projectHome.knowledgeAddFailed, conversation.projectHome.knowledgeDeleteFailed, conversation.projectHome.knowledgeRetryFailed, conversation.projectHome.knowledgeRelinkFailed, conversation.projectHome.knowledgeRefreshFailed, conversation.projectHome.knowledgeDropUnsupported, conversation.projectHome.knowledgeDropFolderMissing

#### #4 — still_valid=True | t_in_scope=True
**Where:**
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:329-333 — Tooltip-wrapped filename; the inner element is `<span className='min-w-0 flex-1 truncate text-13px text-t-primary' onClick={() => void handlePreview(source)}>` at :330 with no role, no tabIndex, no onKeyDown and no cursor-pointer
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:142 — `if (!isPreviewable(source)) return;` — silent no-op for indexing/failed/unsupported rows
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:325 — the row wrapper div is NOT interactive, so the span is the only click target
- packages/desktop/src/renderer/utils/ui/rowActivation.ts:17 activateOnEnterOrSpace, :44 ROW_FOCUS_RING — the helper to reuse
- packages/desktop/src/renderer/components/layout/Sider/SiderItem.tsx:60-74 — canonical usage shape (classNames + ROW_FOCUS_RING, role='button', tabIndex={0}, aria-label, onKeyDown={activateOnEnterOrSpace(...)})

**Fix:** Make the affordance conditional on `isPreviewable(source)` instead of unconditional-but-dead. Compute `const canPreview = isPreviewable(source);` in renderRow, then on the span at :330 spread interactive props only when canPreview: `className={classNames('min-w-0 flex-1 truncate text-13px text-t-primary', canPreview && `cursor-pointer ${ROW_FOCUS_RING}`)}`, plus `role={canPreview ? 'button' : undefined}`, `tabIndex={canPreview ? 0 : undefined}`, `aria-label` = source.fileName, `onKeyDown={canPreview ? activateOnEnterOrSpace(() => void handlePreview(source)) : undefined}`, and keep onClick guarded the same way. Import { ROW_FOCUS_RING, activateOnEnterOrSpace } from '@/renderer/utils/ui/rowActivation' (classNames is already imported at :14). Leave the `!isPreviewable` guard at :142 in place as belt-and-braces. This removes the false affordance rather than adding a dead-end toast, and the existing row tooltip (:313) already reports the status. If the parent wants explicit feedback instead, add a `Message.info(t('conversation.projectHome.knowledgePreviewNotReady'))` in the :142 branch — but it MUST still not call getSourceText (see hazards: test pins that).

**Keys:** conversation.projectHome.knowledgePreviewNotReady (only if the toast variant is chosen; the conditional-affordance fix needs no new key)

#### #6 — still_valid=True | t_in_scope=True
**Where:**
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:258-272 — the isMissingVectors branch renders a bare `<Button type='text' size='mini' className='flex-shrink-0'>{t('...knowledgeRetry')}</Button>` with no Tag and no Tooltip
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:277-296 — the 'failed' branch: the in-file reference (span.flex.items-center.gap-4px wrapper + Tooltip(content=source.error) around a red Tag + a sibling Retry Button)
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:223-241 — renderOcrTag: the in-file reference for Tooltip-wrapping a Tag with an i18n'd explanation
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:452-479 — the footer 'Embed all' block, which is the only place this state is currently explained (globally, not per row)

**Fix:** Reshape :258-272 to mirror the failed branch at :277-296: return `<span className='flex flex-shrink-0 items-center gap-4px'>` containing (1) `<Tooltip content={t('conversation.projectHome.knowledgeNotEmbeddedDetail')}><Tag size='small'>{t('conversation.projectHome.knowledgeStatusNotEmbedded')}</Tag></Tooltip>` — NOT color='red'/'orange': this is a degraded-but-searchable state, not a failure and not destructive, so a neutral (default) tag is correct and reserves red for 'failed'; and (2) the existing Retry Button, additionally wrapped in `<Tooltip content={t('conversation.projectHome.knowledgeRetryEmbedTooltip')}>` so the user knows Retry means 'embed this file now'. Keep `event.stopPropagation()` at :265 (the span at :330 is becoming a click target per #4) and keep the `if (source.progress)` guard at :253 above it untouched — it is what stops Retry appearing mid-embed.

**Keys:** conversation.projectHome.knowledgeStatusNotEmbedded, conversation.projectHome.knowledgeNotEmbeddedDetail, conversation.projectHome.knowledgeRetryEmbedTooltip

#### #12 — still_valid=True | t_in_scope=True
**Where:**
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:350-354 — `<Popconfirm title={...knowledgeDeleteConfirm} okText={...knowledgeDeleteFile} onOk={...}>` with no okButtonProps, so the OK button renders Arco's default primary blue
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:358 — the row trigger Button already carries status='danger', which makes the blue OK button visibly inconsistent
- node_modules/@arco-design/web-react/es/Popconfirm/interface.d.ts:58 — Popconfirm does accept okButtonProps?: ButtonProps
- packages/desktop/src/renderer/pages/settings/AssistantSettings/DeleteAssistantModal.tsx:31 and packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:119 — existing `okButtonProps={{ status: 'danger' }}` precedent

**Fix:** One-line: add `okButtonProps={{ status: 'danger' }}` to the Popconfirm at :350. Per the settled decision a danger-styled Popconfirm is the correct control for a single small item, so do NOT convert it to Modal.confirm. Do not change `okText` — a test locates the confirm button by that exact accessible name (see hazards). Separately worth reporting upward (NOT this file, do not fix here as it is out of scope): the sibling delete confirm at packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:138 still uses `okButtonProps: { status: 'warning' }` for an irreversible conversation delete, which contradicts the same settled decision.

### Hazards
- TEST WILL BREAK WITHOUT A STUB: tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx renders the real card. Arco's Message mounts through the legacy ReactDOM.render React 18 removed, so any Message.* call added to the card throws an unhandled error out of the test. Add `vi.spyOn(Message, 'error')/('warning')/('success').mockReturnValue(undefined as never)` in that file's beforeEach (:175-191). Exact precedent: tests/unit/renderer/conversationDeleteDangerStyling.dom.test.tsx:44-46.
- LOAD-BEARING TEST — non-ready preview: tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx:458-465 ('does not preview a source that has no indexed text yet') clicks the filename text of an `unsupported` source and asserts getSourceTextMock was NOT called. Any #4 fix must keep that call suppressed; a toast-only variant is fine, actually invoking preview is not.
- LOAD-BEARING TEST — Retry accessible name: tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx:319-326 and :328-335 use getByRole('button', { name: 'conversation.projectHome.knowledgeRetry' }) and expect exactly one match on a single-source list. The #6 fix must not change the Retry button's text/aria-label, and must not introduce a second element with that accessible name (wrapping it in a Tooltip is safe; adding aria-label to the Tag is not).
- LOAD-BEARING TEST — no Retry during embed: tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx:306-317 asserts queryByRole(button, knowledgeRetry) is absent when `progress` is set. Keep the `if (source.progress) return <Tag>` guard at ProjectKnowledgeCard.tsx:253 ABOVE the isMissingVectors branch; reordering silently breaks this.
- LOAD-BEARING TEST — quiet healthy row: tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx:215-223 and :225-229 assert a fully-embedded ready row shows no status text and no footer note. The #6 tag must stay inside the isMissingVectors branch only.
- FRAGILE TEST QUERY — delete confirm: tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx:366-370 finds the Popconfirm OK button as 'the button named conversation.projectHome.knowledgeDeleteFile whose data-testid is not knowledge-delete-s-ready' — i.e. the row trigger and the OK button deliberately share an accessible name. Adding okButtonProps is safe; changing okText (:352) or the trigger's aria-label (:360) breaks this query.
- LOAD-BEARING GUARD — folderMissing = zero deletions: ProjectKnowledgeCard.tsx:178 (handleDrop) and :189 (handleDragOver) early-return, and the header reveal action is hidden at :382. tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx:633-640 pins 'takes no drops while the folder is missing'. If #1 adds a warning toast on that path, addSources must still not be called (and the Message stub above becomes mandatory).
- LOAD-BEARING GUARD — `busy` (ProjectKnowledgeCard.tsx:94) gates Embed all; pinned by tests :543-559. `isMissingVectors` (:38) is the single predicate behind both the footer Embed-all block (:452) and the row Retry branch (:258) — changing it moves both.
- ARCO PORTALS: Popconfirm (:350), every Tooltip, and the Drawer inside KnowledgeSourcePreview all render outside the card's DOM subtree. Assert via findBy*/screen (not container queries), and note the styling contract for a confirm lives in okButtonProps, not in rendered class names — which is why conversationDeleteDangerStyling.dom.test.tsx asserts on the props object instead of the DOM.
- SHARED COMPONENT: KnowledgeSourcePreview is consumed by BOTH this card (:482) and packages/desktop/src/renderer/pages/conversation/knowledge/KnowledgeCitationsContext.tsx:137 (citation click-through, which passes the `anchor` prop the card does not). Do not change its props signature while fixing the card.
- HOOK HAS NO i18n: useProjectKnowledge.ts imports neither react-i18next nor Arco. Putting toasts in the hook would force `useTranslation` + `Message` into it AND require tests/unit/renderer/useProjectKnowledge.dom.test.ts (which renders via renderHook with no i18n provider and mocks only `@/common`) to gain a react-i18next mock plus a Message stub. Keep toasts in the card; the hook should only gain try/finally + rethrow.
- HOOK CONTRACT PINNED: tests/unit/renderer/useProjectKnowledge.dom.test.ts:136-158 asserts addSources/removeSource/retrySource forward `{ projectId, sourceId|filePaths, workspace }` unchanged, and :160-172 that syncNow refetches. A try/finally that swallows the rejection would not fail these tests but WOULD silently defeat the card-side toast — rethrow explicitly.
- UNO TOKEN TRAPS that apply here: numeric utilities are hijacked into colours in this theme (`outline-1` → outline-color, `ring-2` → ring colour, neither sets a width), which is exactly why ROW_FOCUS_RING is written as one arbitrary property — reuse the constant, never hand-roll `outline-1`. And in dark mode --bg-3 === --dialog-fill-0, so if any new divider/border is added on this card use border-4, not border-3 (the existing footer at :453 uses `border-t-light`, which is fine).
- No hex/raw colours: #6's tag must use Arco's Tag `color` prop or semantic classes only. Note ProjectKnowledgeCard.tsx:376 uses `!border-primary-5` for the drag accent and its comment warns the brand override only regenerates part of the primary scale (so `bg-primary-1` is still Arco blue) — do not reach for primary-scale fills when adding the tag.
- Gate discipline for whoever implements: the worktree needs `bun install` before believing any red gate, and touching renderer + locales requires `bun run i18n:types` and `node scripts/check-i18n.js` in addition to lint/format/tsc.

### Tests
- tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx
- tests/unit/renderer/useProjectKnowledge.dom.test.ts
- tests/unit/pages/project/ProjectHomePage.dom.test.tsx
- tests/unit/renderer/conversationDeleteDangerStyling.dom.test.tsx

## packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx
**Summary:** ProjectChatList is a single 267-line function component (no sub-files) rendering the Project Home "Chats" region: a heading + Arco `Tag` count badge + conditional "Show all" `Button` (packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:163-182), then either an Arco `Empty` state (184-192) or a flat list of rows (194-260). State is a single `const [showAll, setShowAll] = useState(false)` (:56); `visibleChats` slices to `VISIBLE_ROW_COUNT = 5` (:26, :58) and `hasHiddenChats = !showAll && chats.length > VISIBLE_ROW_COUNT` (:59). Three local action handlers call ipcBridge directly and emit `chat.history.refresh`: `handleTogglePin` (:61-86), `handleRenameStart` (:88-129, imperative `Modal.confirm` with a bare `Input`), `handleDeleteClick` (:131-159, imperative `Modal.confirm`). Each row (:199-257) is a `<div onClick>` with the `group` class (:203) containing an `@icon-park/react` `MessageOne`, title/snippet block (:209-212), a relative-time `<span className='... group-hover:hidden'>` (:213-215), and an action cluster `<span className='hidden shrink-0 items-center gap-4px group-hover:flex' onClick={stopPropagation}>` (:216-219) holding three Tooltip-wrapped Arco `Button`s (pin :224-232, rename :235-243, delete :246-254). The component is used only from packages/desktop/src/renderer/pages/project/ProjectHomePage.tsx:80. `t()` IS already in scope: `import { useTranslation } from 'react-i18next'` (:16) and `const { t } = useTranslation()` (:54) — no hook needs adding for any of these fixes. The companion packages/desktop/src/renderer/pages/project/components/ProjectChatList.module.css is only 30 lines and holds exactly three rules: `.row` bottom border `var(--bg-3)` (:19-21), `.row:last-child` border none (:23-25), `.row:hover` background `var(--color-fill-2)` (:27-29).

**Reuse these in-file patterns:**
- packages/desktop/src/renderer/utils/ui/rowActivation.ts:17 `activateOnEnterOrSpace` and :44 `ROW_FOCUS_RING` — the mandated shared helper for #7 (already consumed by 7 components; see SiderItem.tsx:63,74 for the shortest example)
- packages/desktop/src/renderer/components/layout/Sider/SiderItem.tsx:107 and :146 — `'hidden group-hover:flex group-focus-within:flex'`, the exact in-repo string for the #7 reveal fix
- packages/desktop/src/renderer/components/layout/Sider/SiderItem.tsx:156-161 — keyboard handler on a nested action trigger that does `preventDefault()` + `stopPropagation()` so the parent row does not also fire
- packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx:284-300 — full row-as-button treatment: ROW_FOCUS_RING in classNames, role/tabIndex/aria-label, onKeyDown={activateOnEnterOrSpace(handleRowClick)}
- packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx:432-445 — the same cluster reveal + keydown stopPropagation inside a row that navigates
- packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx:420-441 — THE declarative rename Modal reference for #8 (confirmLoading, okButtonProps.disabled on trimmed name, borderRadius 12px, alignCenter, getPopupContainer, Input with onPressEnter + placeholder + allowClear)
- packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts:161-199 — the handler half of that reference: seed state on start, guard on empty, setRenameLoading around the ipcBridge call in try/finally, refreshConversationCache + emitter.emit('chat.history.refresh') + Message.success/error
- packages/desktop/src/renderer/components/layout/Sider/TeamSiderSection.tsx:72-94 (state + handleRenameConfirm) and :319-344 (Modal + Input) — the same pattern contained in ONE component, the closest structural template for ProjectChatList
- packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts:94-101 — the canonical single-conversation delete confirm with `okButtonProps: { status: 'danger' }` and the same four i18n keys this file already uses (#12)
- packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:109-119 — in-directory precedent that destructive project-home confirms use `status: 'danger'`
- Error/success feedback already in-file: `Message.error(t('conversation.history.renameFailed'))` (ProjectChatList.tsx:117,121), `Message.success(t('conversation.history.renameSuccess'))` (:115), `Message.error(t('conversation.history.pinFailed'))` (:78,82) — reuse these, do not introduce a new toast helper
- Existing i18n keys available with no new translation work: conversation.history.renameTitle / renamePlaceholder / saveName / cancelEdit / deleteTitle / deleteConfirm / confirmDelete / cancelDelete, and common.collapse (all present in all 12 locales)

### Findings

#### #7 — still_valid=True | t_in_scope=True
**Where:**
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:199-207 — the row is `<div key onClick={() => navigate(...)}>` with NO role, NO tabIndex, NO onKeyDown, NO aria-label
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:203 — the `group` class lives here (needed for any group-focus-within variant to resolve)
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:213-215 — time span is `'shrink-0 text-12px text-t-tertiary group-hover:hidden'`, no group-focus-within:hidden
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:216-219 — action cluster span is `'hidden shrink-0 items-center gap-4px group-hover:flex'`, no group-focus-within:flex; it has `onClick={(event) => event.stopPropagation()}` but NO onKeyDown stopPropagation
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:224-254 — the three Arco Buttons already carry aria-label and data-testid, so only reachability (not labelling) is broken

**Fix:** Import the existing shared helper — `import { ROW_FOCUS_RING, activateOnEnterOrSpace } from '@/renderer/utils/ui/rowActivation';` (do NOT inline handlers; the helper is at packages/desktop/src/renderer/utils/ui/rowActivation.ts:17 and :44). On the row div (:199-207): add `ROW_FOCUS_RING` into the existing classNames() call at :202-205, plus `role='button'`, `tabIndex={0}`, `aria-label={conversation.name}`, and `onKeyDown={activateOnEnterOrSpace(() => navigate(`/conversation/${conversation.id}`))}` — factor the navigate call into a local `const openRow = () => navigate(...)` so click and key share it. On the time span (:213): add `group-focus-within:hidden` next to `group-hover:hidden`. On the action cluster span (:216-217): add `group-focus-within:flex` next to `group-hover:flex`, add `onKeyDown={(event) => event.stopPropagation()}` beside the existing onClick stopPropagation, and add `data-testid={`project-chat-actions-${conversation.id}`}` so the reveal variant is assertable the way tests/unit/renderer/ConversationRow.dom.test.tsx:495-500 asserts it. Do NOT add a focus background: rowActivation.ts:36-42 documents that a companion `focus-visible:bg-fill-3` was verified dead in the running app and deliberately dropped; the outline is the whole treatment. LOAD-BEARING ORDERING: `group-focus-within:flex` only makes the buttons tab-reachable BECAUSE the row itself becomes tabbable in the same edit — a display:none element cannot receive focus, so focusing the row is what flips the cluster to display:flex and puts the buttons in the tab order. Shipping the CSS variant without tabIndex on the row fixes nothing.

#### #8 — still_valid=True | t_in_scope=True
**Where:**
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:88-129 — `handleRenameStart` uses imperative `Modal.confirm` (:91)
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:90 + :94-100 — the name is tracked in a closure `let nextName` mutated by `onChange`, and the content is a bare `<Input autoFocus defaultValue>` with no `onPressEnter`, no `placeholder`, no `allowClear`
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:91-126 — no `okButtonProps` at all on this confirm (contrast the delete confirm at :138 which does pass okButtonProps)
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:105-106 — `const trimmedName = nextName.trim(); if (!trimmedName) return;` is the silent no-op
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:124-125 — this confirm passes `alignCenter`/`getPopupContainer` but, unlike every sibling modal, omits `style: { borderRadius: '12px' }` (the delete confirm at :153 has it)

**Fix:** THE REFERENCE IMPLEMENTATION the finding asks for is a matched pair: packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx:420-441 (the declarative `<Modal>` with `confirmLoading={renameLoading}`, `okButtonProps={{ disabled: !renameModalName.trim() }}`, `style={{ borderRadius: '12px' }}`, `alignCenter`, `getPopupContainer`, and an `<Input autoFocus value onChange onPressEnter={handleRenameConfirm} placeholder allowClear />`) driven by packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts:161-199 (`handleEditStart` seeds id+name+visible; `handleRenameConfirm` guards `if (!renameModalId || !renameModalName.trim()) return;` then setRenameLoading(true) → ipcBridge.conversation.update → refreshConversationCache → emitter.emit('chat.history.refresh') → close + Message.success, `finally setRenameLoading(false)`). The team variant at packages/desktop/src/renderer/components/layout/Sider/TeamSiderSection.tsx:319-344 is the same shape in a single component and is the closer structural template for this file. Minimal fix: replace the imperative Modal.confirm with three pieces of local state (`renameTarget: TChatConversation | null`, `renameName: string`, `renameLoading: boolean`), have the rename Button (:242) only set them, extract the existing async body (:107-122) into a `handleRenameConfirm` callback with the `if (!renameTarget || !renameName.trim()) return;` guard and a try/finally around setRenameLoading, and render one controlled `<Modal>` after the list (inside the outer div at :162, or as a sibling in a fragment) mirroring GroupedHistory/index.tsx:420-441 with `title={t('conversation.history.renameTitle')}`. IMPORTANT CORRECTION to the finding's wording: the 'no loading state' sub-claim is only half true — node_modules/@arco-design/web-react/es/Modal/confirm.js:81-91 sets `modalConfig.confirmLoading = true` whenever `onOk` returns a thenable, and this onOk is `async`, so a spinner already appears. What that same Arco code makes WORSE is the empty-name path: because an async function always returns a promise, `ret.then(() => onCancel(true))` fires on the early `return` at :106 and CLOSES the modal, so an empty name doesn't merely no-op — the dialog dismisses itself and the rename is silently discarded. The disabled-when-empty guard is also structurally impossible today: `nextName` is a closure `let` (:90), not state, so nothing re-renders to re-evaluate `okButtonProps.disabled`. That is the real reason this must become a controlled Modal rather than gain a prop.

**Keys:** conversation.history.renameTitle (exists, all 12 locales — 'Rename Chat'), conversation.history.renamePlaceholder (exists — 'Please enter a new name'), conversation.history.saveName (exists — 'Save'), conversation.history.cancelEdit (exists — 'Cancel'), conversation.history.renameSuccess / renameFailed (exists, already used at :115/:117)

#### #9 — still_valid=True | t_in_scope=True
**Where:**
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:59 — `const hasHiddenChats = !showAll && chats.length > VISIBLE_ROW_COUNT;` (the `!showAll` term is what removes the control permanently)
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:172-181 — the Button renders only `if (hasHiddenChats)` and its onClick is the one-way `() => setShowAll(true)` (:177)
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:179 — label is hardcoded to `t('conversation.projectHome.showAll')`
- packages/desktop/src/renderer/services/i18n/locales/en-US/conversation.json — `projectHome.showAll` exists ('Show all'); `projectHome.showLess` is absent in ALL 12 locales (verified de-DE, en-US, es-ES, fa-IR, ja-JP, ko-KR, pt-BR, ru-RU, tr-TR, uk-UA, zh-CN, zh-TW)
- packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts:785 — `'conversation.projectHome.showAll'` is in the generated union; a new key needs `bun run i18n:types` to regenerate

**Fix:** Drop the `!showAll` term so the control survives expansion: rename :59 to `const canToggleChats = chats.length > VISIBLE_ROW_COUNT;` and gate the Button on that (:172). Make the Button a real toggle: `onClick={() => setShowAll((prev) => !prev)}` and `{t(showAll ? 'conversation.projectHome.showLess' : 'conversation.projectHome.showAll')}`. Add `aria-expanded={showAll}` on the Arco Button for screen readers. Then add the `showLess` leaf to projectHome in all 12 conversation.json locale files and regenerate types. NOTE the two-way interaction with #7: once collapsing is possible, focus can be inside a row that disappears; keep it simple (no focus restoration) since the toggle Button retains focus itself — clicking it never moves focus into the list.

**Keys:** conversation.projectHome.showLess — NEW, must be added to projectHome in all 12 locales under packages/desktop/src/renderer/services/i18n/locales/<locale>/conversation.json, then `bun run i18n:types` + `node scripts/check-i18n.js`, ALTERNATIVE that adds zero keys: `common.collapse` already exists and is translated in all 12 locales (en 'Collapse', zh-CN '收起', de 'Einklappen', ja '折りたたむ', ru 'Свернуть', …). Cheaper, but pairs 'Show all' with 'Collapse'; a dedicated showLess reads better next to showAll.

#### #12 — still_valid=True | t_in_scope=True
**Where:**
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:138 — `okButtonProps: { status: 'warning' },` inside `handleDeleteClick`'s Modal.confirm (:131-159)

**Fix:** One-token change: `okButtonProps: { status: 'danger' }`. This is the only `status: 'warning'` left in the whole project-home directory, and it is the odd one out for the same operation elsewhere: the sidebar's identical single-chat delete uses danger at packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts:101 (batch delete likewise at :135), and this file's own sibling ProjectHeader.tsx:119 (project Remove) already uses `status: 'danger'`. Deleting a conversation removes user data, so per the settled decision it is red; keeping Modal.confirm (rather than switching to Popconfirm) is correct here because a whole conversation is a container, and it also keeps the existing test's `modalConfirmMock` contract intact. While in this handler, also consider the destructive-hover already present on the trigger Button (:251 `hover:!bg-danger-1 hover:!text-danger-6`) — it is already red, so the confirm was the only inconsistency.

### Hazards
- TEST THAT WILL BREAK — packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx rename fix (#8) invalidates tests/unit/pages/project/ProjectChatList.dom.test.tsx:184-196 ('confirms rename via a Modal and calls the conversation update API'). It asserts `modalConfirmMock` was called exactly once with `expect.objectContaining({ title: 'conversation.projectHome.rename' })` and that the stubbed synchronous onOk produced `updateMock({ id: 'c1', updates: { name: 'Chat one' } })`. A declarative `<Modal>` never calls `Modal.confirm`, so this test MUST be rewritten to open the modal, type into the Input, and press Enter / click OK. Note the modal title also changes from `conversation.projectHome.rename` to `conversation.history.renameTitle` if you follow the sidebar reference.
- TEST WHOSE NAME BECOMES A LIE — tests/unit/pages/project/ProjectChatList.dom.test.tsx:137-144 'hides the "Show all" toggle once all chats are already shown' still PASSES after #9 (the showAll key text is gone because the label flipped to showLess), so CI will not catch the drift. It now documents behaviour that no longer exists and must be replaced with a round-trip assertion: click showAll → showLess label present and 7 rows rendered → click showLess → showAll label back and only 5 rows.
- Arco Modal.confirm's promise handling is load-bearing and non-obvious: node_modules/@arco-design/web-react/es/Modal/confirm.js:81-94 auto-closes the dialog on `onOk` promise RESOLUTION and only keeps it open on REJECTION. Both handlers here swallow their errors in try/catch (:119-122, :148-151), so today every path — including failure and the empty-name early return — closes the modal. If you keep any Modal.confirm, do not assume a caught failure leaves the dialog open.
- Arco's imperative Message/Modal.confirm mount through the legacy `ReactDOM.render` React 18 removed (via `../_util/react-dom`). tests/unit/pages/project/ProjectChatList.dom.test.tsx:49-62 already stubs BOTH `Modal.confirm` (running onOk synchronously) and `Message` for this reason. Any new test that reaches Message.success/error, or that renders a real Arco `<Modal>`, must keep or extend that mock — and a declarative `<Modal>` still portals to `document.body`, so query it via `screen` (body-scoped), not the render container.
- The action cluster's `onClick={(event) => event.stopPropagation()}` at ProjectChatList.tsx:218 has NO keyboard twin. Once the row gets `onKeyDown={activateOnEnterOrSpace(...)}` (#7), pressing Enter or Space on a focused pin/rename/delete Arco Button fires the button AND bubbles to the row handler, so the app both performs the action and navigates away. This exact bug is already regression-tested for the sidebar at tests/unit/renderer/ConversationRow.dom.test.tsx:515-526 ('does not also fire the row when the trigger is keyed'), with the fix at ConversationRow.tsx:442-445 and SiderItem.tsx:156-161. Add the onKeyDown stopPropagation in the same edit and mirror that test.
- `group-focus-within:*` cannot rescue a `display: none` cluster on its own — the buttons are unfocusable while hidden, so the reveal depends entirely on the ROW becoming focusable (tabIndex=0) in the same change. Splitting #7 into 'CSS now, semantics later' ships a no-op.
- Do NOT re-attempt a focus background via Uno: packages/desktop/src/renderer/utils/ui/rowActivation.ts:24-43 records that `outline-1`/`ring-2` compile to outline-COLOR/ring-COLOR with no width in this theme (numeric utilities are merged into theme.colors), and that a companion `focus-visible:bg-fill-3` reached the stylesheet yet never painted. Reuse ROW_FOCUS_RING verbatim; if a focus background is genuinely wanted here it must go in ProjectChatList.module.css as `.row:focus-visible { background-color: var(--color-fill-2); }` (this file, unlike the sidebar rows, already owns its hover background there at :27-29) — but that is beyond the minimal fix.
- The dark-mode `--bg-3 == --dialog-fill-0` trap does NOT bite this file, so do not 'fix' it: ProjectChatList has no card frame and sits on `--bg-chat-surface`, which is `var(--bg-base)` = #0b0e14 in dark (packages/desktop/src/renderer/styles/themes/default-color-scheme.css:109-113), so the `.row` divider `var(--bg-3)` = #1e2536 (:112) is visible. Leave ProjectChatList.module.css:20 alone.
- Locale parity is convention-enforced, not test-enforced, for this key: scripts/check-i18n.js:186-204 only WARNS on missing keys (it exits non-zero for other classes of problem), and the strict locale-parity test in tests/unit/common/i18n.test.ts:130-199 is scoped to `messages.toolActivity` only. So shipping `showLess` in en-US alone would go green while leaving 11 locales showing a raw key — translate all 12 and run `bun run i18n:types` (packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts is generated; a hand-edit will be clobbered).
- `role='button'` on a row that contains three real `<button>`s is a nested-interactive a11y compromise, but it is the settled house pattern (ConversationRow.tsx:297-300, SiderItem.tsx:71-74, plus SiderScheduledEntry/SiderDashboardEntry/SiderAssistantEntry/SiderToolbar/TeamSiderSection all do it). Follow it; do not redesign the row into a semantic <button> — Arco's `.arco-btn` display rule breaks the group-hover children, which is exactly why rowActivation.ts:11-14 exists.
- The three handlers deliberately duplicate `useConversationActions` instead of importing it — the reason is documented in the component's own doc comment at ProjectChatList.tsx:28-52 (the hook needs 17 props from four sidebar-only hooks). When fixing #8, copy the sidebar's modal SHAPE, do not refactor toward importing the hook; that would be scope expansion and would drag in drag state, batch selection, cron status, and agent-logo resolution.
- ProjectHeader.tsx:66-89 carries the twin of the #8 rename bug (same closure-`let` + bare Input + silent empty return, minus even the async loading). It is explicitly out of scope for this file, but the two are separate copies — if both get fixed, resist extracting a shared rename modal component unless the parent asks; and note ProjectChatList.tsx:19 already imports `formatActiveDuration` FROM ProjectHeader, so the two files are coupled and a careless shared-module extraction there risks a circular import.

### Tests
- tests/unit/pages/project/ProjectChatList.dom.test.tsx
- tests/unit/pages/project/ProjectHeader.dom.test.tsx
- tests/unit/pages/project/ProjectHomePage.dom.test.tsx
- tests/unit/renderer/ConversationRow.dom.test.tsx
- tests/unit/renderer/sidebarProjectRowActions.dom.test.tsx
- tests/unit/common/i18n.test.ts

## packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx
**Summary:** Three sibling components of the Project Home hub (rendered from ProjectHomePage.tsx:71-92, each taking only `project: ForgeProject`). ProjectHeader.tsx (196 lines) exports `formatActiveDuration` (:41-47) plus the component; renders name + a `path · N chats · active <token>` subline (:168-181) and a `⋯` Dropdown with Rename/Relink/Reveal/Remove whose handlers are useCallbacks at :66-146. Remove already uses `okButtonProps: { status: 'danger' }` (:119) and `!text-danger-6` (:159), so the settled red rule is already satisfied there. Arco imports at :12 are Button, Dropdown, Input, Menu, Modal — no Message. ProjectInstructionsCard.tsx (101 lines) is a view/edit toggle over `project.instructions` with `editing`/`draft` state (:33-34) and `handleSave` at :47-51; Message IS already imported (:9) but only `.success` is used. ProjectFilesCard.tsx (110 lines) is a thin card around `WorkspaceProjectFilesFlyout` (:91-98) fed by `useProjectFiles`; the card `extra` reveal button (:56-66) correctly uses showItemInFolder, the row callback at :97 wrongly does too. Arco imports at :12 are Alert, Button, Card, Spin, Tooltip — no Message. All three files already have `t()` in scope via react-i18next (ProjectHeader :15/:57, InstructionsCard :12/:32, FilesCard :15/:35), so no hook needs adding — only `Message` imports. Critical upstream fact: `updateProject` (renderer/pages/conversation/projects/projectStorage.ts:143-178) is SYNCHRONOUS, returns `ForgeProject | null` (null at :151-153 when the id is gone), THROWS `new Error('PROJECT_WORKSPACE_DUPLICATE')` at :160, and stamps `updated_at: now()` on every mutation (:169). `removeProject` (:180-189) returns a boolean. `writeProjects` (:87-92) silently no-ops when storage is null.

**Reuse these in-file patterns:**
- packages/desktop/src/renderer/pages/project/components/ProjectInstructionsCard.tsx:9 — Message already imported in-file (only .success used, :50), so #2 needs no import change
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:104-126 — same-directory precedent for a Modal.confirm onOk with success/error toasts + console.error; the closest in-file style guide for #3 and #8
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:350-363 — the danger-styled Popconfirm for a single small item (status='danger' Button inside Popconfirm), matching the settled destructive rule
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:347 — ipcBridge.shell.openFile precedent in this very directory (#10)
- packages/desktop/src/renderer/pages/conversation/Workspace/hooks/useWorkspaceFileOps.ts:88-98 — canonical open handler: try/catch + messageApi.error(t('conversation.workspace.contextMenu.openFailed')); :104-114 is the reveal twin
- packages/desktop/src/renderer/pages/conversation/Workspace/components/WorkspaceDialogs.tsx:41-60 — the declarative controlled rename Modal (value/onChange/onPressEnter/placeholder/confirmLoading) to copy for #8
- packages/desktop/src/renderer/pages/conversation/Workspace/hooks/useWorkspaceFileOps.ts:190-199 — empty-name handling that warns instead of silently closing (#8)
- packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx:291-321 and :323-342 — the sidebar rename/relink handlers ProjectHeader was adapted from; :338 is the exact Message.error line #3 should mirror
- packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts:288-329 — the sidebar remove-project handler with full result checking (detachResults.every(Boolean) && removedProject) and both toasts
- packages/desktop/src/renderer/pages/settings/ToolsSettings/McpServerHeader.tsx:56 and packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationSearchPopover.tsx:84 — the two existing absolute-timestamp formatting conventions for #11's tooltip
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:340-349 — Tooltip-wrapping an action with a matching aria-label, the Arco Tooltip usage style for #11
- packages/desktop/src/renderer/utils/ui/rowActivation.ts:17 and :44 — activateOnEnterOrSpace / ROW_FOCUS_RING; read and deliberately NOT applicable to these five findings (see hazards)

### Findings

#### #2 — still_valid=True | t_in_scope=True
**Where:**
- packages/desktop/src/renderer/pages/project/components/ProjectInstructionsCard.tsx:47-51 (whole handleSave)
- packages/desktop/src/renderer/pages/conversation/projects/projectStorage.ts:143-178 (updateProject failure modes)

**Fix:** STILL VALID, unchanged by kb-ui-polish. Current body is exactly: updateProject({id, instructions: draft.trim()}); setEditing(false); Message.success(...). Three real failure modes, none handled: (a) updateProject returns null (projectStorage.ts:151-153) when the project row is gone; (b) it THROWS PROJECT_WORKSPACE_DUPLICATE at projectStorage.ts:160 even for an instructions-only save, because nextWorkspace falls back to target.workspace (:155) and the duplicate scan (:156-158) compares every OTHER project against it — a pre-existing duplicate-workspace pair makes every instructions save throw; (c) storage.setItem (:91) can throw on quota. Minimal fix: capture the return value and wrap in try/catch. On a truthy result -> setEditing(false) + Message.success. On null-or-throw -> leave `editing` true so the draft is not lost, and Message.error(t('conversation.projectHome.instructionsSaveFailed')). `Message` is already imported at :9 so `.error` needs no import change; `t()` already in scope.

**Keys:** conversation.projectHome.instructionsSaveFailed (NEW — no existing key fits; add to all 12 locales under conversation.json > projectHome, then regenerate i18n-keys.d.ts)

#### #3 — still_valid=True | t_in_scope=True
**Where:**
- packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:81-85 (rename onOk — NO try/catch at all)
- packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:98-103 (relink — try/catch + console.error only)
- packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:120-142 (remove onOk — try/catch + console.error only)
- packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:12 (Arco import line — Message missing)
- packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx:333-339 (sidebar relink reference)
- packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts:288-329 (sidebar remove reference)
- packages/desktop/src/renderer/pages/project/components/ProjectFilesCard.tsx:38-50 (same console.error-only swallow, related location)

**Fix:** STILL VALID, all three, and worse than stated. Rename (:81-85) has NO try/catch whatsoever: a PROJECT_WORKSPACE_DUPLICATE throw rejects out of onOk with no message, and a null return is a silent no-op while the modal closes as if it worked. Relink (:98-103) and Remove (:120-142) log only. Remove additionally IGNORES both `removeProject`'s boolean return (:131) and the `Promise.all` detach results (:122-130), and puts `navigate('/guid')` (:138) on the unconditional path. The sidebar does check both (useConversationActions.ts:303-321: `detachResults.every(Boolean)` && `removedProject` -> success toast, else error toast). Minimal fix: add `Message` to the :12 import; give rename a try/catch + null-check -> Message.error(t('conversation.history.renameFailed')); relink -> Message.error(t('conversation.history.createProjectFailed')) exactly as GroupedHistory/index.tsx:338 already does; remove -> check both results, Message.success(t('conversation.history.removeProjectSuccess')) / Message.error(t('conversation.history.removeProjectFailed')) and move navigate('/guid') onto the success branch only. ZERO new i18n keys — all four keys already exist in all 12 locales and are already wired in i18n-keys.d.ts (:638-639).

**Keys:** conversation.history.renameFailed (EXISTS), conversation.history.createProjectFailed (EXISTS), conversation.history.removeProjectSuccess (EXISTS), conversation.history.removeProjectFailed (EXISTS)

#### #8 — still_valid=True | t_in_scope=True
**Where:**
- packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:66-89 (handleRename, Modal.confirm + bare Input)
- packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:67 + :74-76 (mutable closure `nextName`)
- packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:82-83 (empty-name early return)
- packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx:296-305 (sidebar version — has the placeholder ProjectHeader lacks)
- packages/desktop/src/renderer/pages/conversation/Workspace/components/WorkspaceDialogs.tsx:41-60 (declarative pattern to copy)
- packages/desktop/src/renderer/pages/conversation/Workspace/hooks/useWorkspaceFileOps.ts:190-199 (empty-name handling to copy)

**Fix:** STILL VALID (ProjectHeader half). Concrete defects: (a) `nextName` is a plain closure variable (:67) mutated from onChange (:74-76), so nothing re-renders and okButtonProps.disabled cannot reflect emptiness; (b) an empty/whitespace name hits `if (!trimmedName) return;` (:83) -> onOk resolves -> Arco CLOSES the modal, so the rename silently vanishes with no feedback; (c) no `placeholder` (the sidebar equivalent has one at GroupedHistory/index.tsx:300); (d) no onPressEnter. Minimal fix, following the pattern already in this repo (WorkspaceDialogs.tsx:41-60 + useWorkspaceFileOps.ts:190-199): replace Modal.confirm with a state-driven declarative <Modal visible={renameVisible}> holding the draft in useState, <Input value onChange onPressEnter={confirm} placeholder={t('conversation.history.projectNamePlaceholder')} />, okButtonProps={{ disabled: !draft.trim() }}, Message.warning(t('conversation.workspace.contextMenu.renameEmpty')) instead of a silent close, keeping alignCenter and getPopupContainer={() => document.body}. A cheaper Modal.confirm-preserving variant is `return Promise.reject(...)` from onOk to keep it open, but grep found ZERO Promise.reject-in-onOk precedent anywhere in the renderer, so the declarative route is safer. Note the declarative route trips a hard test hazard (see hazards). ZERO new i18n keys.

**Keys:** conversation.history.projectNamePlaceholder (EXISTS), conversation.workspace.contextMenu.renameEmpty (EXISTS), conversation.history.renameFailed (EXISTS)

#### #10 — still_valid=True | t_in_scope=True
**Where:**
- packages/desktop/src/renderer/pages/project/components/ProjectFilesCard.tsx:97 (onOpenFile -> showItemInFolder — the bug)
- packages/desktop/src/common/adapter/ipcBridge.ts:177 (the open binding that exists)
- packages/desktop/src/renderer/pages/conversation/Workspace/hooks/useWorkspaceFileOps.ts:88-98 (canonical open handler)
- packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:347 (same-directory precedent)
- packages/desktop/src/renderer/pages/conversation/Workspace/components/WorkspaceProjectFilesFlyout.tsx:19 + :71-77 (prop contract)
- packages/desktop/src/renderer/pages/project/components/ProjectFilesCard.tsx:12 (Arco import line — Message missing)

**Fix:** STILL VALID. Line 97 reads exactly `onOpenFile={(node) => void ipcBridge.shell.showItemInFolder.invoke(node.fullPath)}`. ANSWER ON THE BRIDGE: yes, an open binding exists — `shell.openFile` at packages/desktop/src/common/adapter/ipcBridge.ts:177, `httpPost<void, string>('/api/shell/open-file', (file_path) => ({ file_path }))`, alongside showItemInFolder (:178), openExternal (:179), checkToolInstalled (:180) and openFolderWith (:181). It is already used in 11 renderer call sites including the sibling ProjectKnowledgeCard.tsx:347 and the Workspace panel's own open handler. The prop contract confirms intent: WorkspaceProjectFilesFlyout declares `onOpenFile` (:19) and its row folds folders / calls onOpenFile only for files (:71-77). Minimal fix: swap to `ipcBridge.shell.openFile.invoke(node.fullPath)` with a `.catch(() => Message.error(t('conversation.workspace.contextMenu.openFailed')))`, mirroring useWorkspaceFileOps.ts:92-95 verbatim; add Message to the :12 import. Leave the card `extra` button at :63 on showItemInFolder — that one is a genuine Reveal. ZERO new i18n keys.

**Keys:** conversation.workspace.contextMenu.openFailed (EXISTS, 'Failed to open', in all 12 locales)

#### #11 — still_valid=True | t_in_scope=True
**Where:**
- packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:41-47 (formatActiveDuration helper)
- packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:61-64 (last_opened_at ?? updated_at + Date.now() inside useMemo)
- packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:180 (bare token span, no title/Tooltip)
- packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:173-176 (truncated workspace path, no title/Tooltip)
- packages/desktop/src/renderer/pages/conversation/projects/projectStorage.ts:169 (updated_at bumped on every mutation)
- packages/desktop/src/renderer/pages/project/hooks/useProjectHome.ts:31-36 (stamps last_opened_at on open)
- packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:213-215 (same bare token, out of scope)

**Fix:** STILL VALID, all three sub-claims. The token span (:180) and the truncated path span (:173-176) both carry no title and no Arco Tooltip. The fallback is real at :62 and updateProject bumps updated_at on EVERY mutation (projectStorage.ts:169) including instructions saves and renames, so the fallback branch does surface a metadata edit. TWO nuances that change the fix and are not in the finding text: (1) useProjectHome.ts:31-36 stamps last_opened_at: Date.now() once per opened project on mount, so on Project Home the token almost always reads '1m' anyway — the fallback only bites on the first render before that effect commits, or when the localStorage write no-ops (projectStorage.ts:88-90 returns early, no error, when storage is null); (2) Date.now() is passed into a useMemo whose deps are only the two timestamps (:61-64), so the token freezes for the page's lifetime and will disagree with any tooltip on a long-lived page. Minimal fix: wrap the :180 span in Arco <Tooltip content={new Date(source).toLocaleString()}> (the repo's absolute-format convention — McpServerHeader.tsx:56 and five settings forms use toLocaleString(); ConversationSearchPopover.tsx:84 uses Intl.DateTimeFormat); wrap the :173-176 path span in <Tooltip content={project.workspace}>; and read `project.last_opened_at` directly, rendering the token only when present and otherwise a distinct 'never opened' label. Do NOT change formatActiveDuration's signature or make it return a phrase — see hazards.

**Keys:** conversation.projectHome.metaActiveTooltip (NEW, optional if the tooltip is a bare timestamp), conversation.projectHome.metaNeverOpened (NEW, needed if the fallback is dropped) — both go in all 12 locales + regenerate i18n-keys.d.ts

### Hazards
- HARD BLOCKER for #8's declarative route: tests/unit/pages/project/ProjectHeader.dom.test.tsx:75-81 mocks Arco as `Modal: { ...actual.Modal, confirm: ... }`. Spreading a React component function into an object literal yields a plain OBJECT, not a callable component — the statics survive but `<Modal>` becomes an invalid element type. The test file passes today only because ProjectHeader never renders <Modal> declaratively. Converting rename to a declarative <Modal> WILL crash that whole test file's render. The mock must be rewritten to keep Modal callable, e.g. `const Modal = Object.assign((props) => actualModal(props), actual.Modal, { confirm })`.
- HARD BLOCKER for #3's remove fix: tests/unit/pages/project/ProjectHeader.dom.test.tsx does NOT mock projectStorage, so `removeProject` runs for real against jsdom localStorage where no project 'p1' exists and therefore returns FALSE. Gating success/navigate on that boolean breaks BOTH existing remove tests (:120-129 asserts removeStoreMock fires, :131-145 asserts navigateMock fires). That file must start mocking projectStorage.removeProject — the vi.mock-with-importOriginal pattern is already in the two sibling test files (ProjectInstructionsCard.dom.test.tsx:17-23, ProjectFilesCard.dom.test.tsx:40-46).
- BREAKING TEST for #2: tests/unit/pages/project/ProjectInstructionsCard.dom.test.tsx:82-92 ('saves the trimmed draft and returns to the preview on Save') uses a bare `vi.fn()` for updateProject, which returns undefined. Gating success on a truthy return makes that test take the error branch — messageSuccess never fires and the textbox stays mounted, failing both assertions at :90-91. The mock needs `updateProjectMock.mockReturnValue({ ...baseProject })`.
- Arco Message legacy-render trap applies to all three files: ProjectHeader.dom.test.tsx stubs NO Message at all; ProjectInstructionsCard.dom.test.tsx:25-34 stubs only `Message.success`; ProjectFilesCard.dom.test.tsx stubs no Message. Any fix that calls Message.error / Message.warning runs the real Arco Message through the ReactDOM.render React 18 removed. Every touched test file must add the missing method to its Message stub.
- MOCK SURFACE for #10: tests/unit/pages/project/ProjectFilesCard.dom.test.tsx:20-38 mocks `@/common` with an ipcBridge exposing ONLY fs.getFilesByDir, shell.showItemInFolder and dialog.showOpen. Switching the row callback to shell.openFile without extending that mock makes any row-click test throw 'Cannot read properties of undefined (reading invoke)'. No current test clicks a file row, so no existing assertion breaks — but a new test needs the mock extended. The reveal-button assertion at :136 (`toHaveBeenCalledExactlyOnceWith('/w/alpha')`) still holds since the card `extra` button keeps showItemInFolder.
- BREAKING TEST for #11: tests/unit/pages/project/ProjectHeader.dom.test.tsx:87-93's fixture has NO last_opened_at, and :108 asserts `screen.getByText('conversation.projectHome.metaActive')` is present. Dropping the updated_at fallback means the token is not rendered for that fixture and the assertion fails — either add last_opened_at to the fixture or split the assertion into an opened/never-opened pair.
- SHARED EXPORT for #11: formatActiveDuration is exported from ProjectHeader.tsx:41 and consumed by ProjectChatList.tsx:214 for per-row conversation.modified_at. Do not change its signature or make it return a phrase. The docblock at :29-40 explicitly records WHY the returned `time` must stay a bare language-neutral token — zh-CN ('{{time}}活跃') and ja-JP place the word on the other side of the {{time}} slot, so baking 'ago'/'active' into the helper breaks those locales.
- LOAD-BEARING and CORRECT already, do not 'fix': ProjectHeader.tsx:136 and its comment at :132-135 — the projectKnowledge.removeStore cleanup is deliberately fire-and-forget with a swallowing .catch(() => {}) so a failed store delete cannot reverse a confirmed deletion. Test :131-145 pins exactly that. Any #3 error-handling rewrite must keep that call OUTSIDE the new error path.
- ARCO PORTALS: every dialog in these files passes getPopupContainer={() => document.body} (ProjectHeader.tsx:87, :144, and the Dropdown at :183). Keep that on any replacement Modal/Tooltip or the popup escapes the page's overflow container.
- SETTLED-DECISION INCONSISTENCY worth flagging but OUT of the assigned scope: ProjectChatList.tsx:138 uses `okButtonProps: { status: 'warning' }` for a destructive chat delete. ProjectHeader.tsx:119 already correctly uses status: 'danger'. Do not accidentally copy the ChatList variant when editing #3/#8.
- rowActivation.ts is NOT needed by any of these five findings. ProjectFilesCard's file rows are real Arco <Button> elements inside WorkspaceProjectFilesFlyout.tsx:62, so they already have native keyboard semantics — adding activateOnEnterOrSpace or ROW_FOCUS_RING there would be redundant. (ProjectChatList.tsx:200-207 IS a bare clickable div and would need it, but that file is not assigned.)
- NEW i18n keys must be added to all 12 locale dirs (en-US, zh-CN, zh-TW, ja-JP, ko-KR, de-DE, es-ES, pt-BR, ru-RU, tr-TR, uk-UA, fa-IR) under services/i18n/locales/<locale>/conversation.json, followed by `bun run i18n:types` (regenerates services/i18n/i18n-keys.d.ts) and `node scripts/check-i18n.js`. Only #2 and #11 need new keys; #3, #8 and #10 can be done with zero locale churn.

### Tests
- tests/unit/pages/project/ProjectHeader.dom.test.tsx
- tests/unit/pages/project/ProjectInstructionsCard.dom.test.tsx
- tests/unit/pages/project/ProjectFilesCard.dom.test.tsx
- tests/unit/pages/project/ProjectHomePage.dom.test.tsx
- tests/unit/pages/project/ProjectChatList.dom.test.tsx
- tests/unit/pages/project/useProjectHome.dom.test.tsx
- tests/unit/pages/project/useProjectFiles.test.ts
- tests/unit/workspace/WorkspaceProjectFilesFlyout.dom.test.tsx
- tests/unit/workspace/WorkspaceProjectFilesMultiTab.dom.test.tsx
