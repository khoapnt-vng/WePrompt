# UI Improvements — parallel stream coordination

> ## ✅ EPIC COMPLETE — 2026-07-31. All five streams merged into `sprint1`.
> S1 !19 · S2 !24 · S4 !26 + !28 · S5 !27 · S3 !29 (`ba0b6e54b`, last to land).
>
> **This doc is now history, not a work list.** Two parts are still worth reading
> before touching UI in this repo, because both cost multiple sessions:
> the **🔬 COMPILED-CSS FACTS** block below (including correction **4**, added
> after implementation — generation proves what a class *emits*, not whether it
> *wins*), and the **Escalations** section at the bottom, which carries the one
> unfixed cross-cutting bug (`CollapsibleContent`) plus the `--bg-3` / dead-class
> findings.
>
> Per-stream statuses and per-finding outcomes are recorded inline. Where a
> finding turned out wrong, the original text is struck through rather than
> deleted, so the reasoning is auditable.

> **Read this before starting any UI-improvement stream session.** It exists so
> parallel sessions don't collide. Gitignored working doc (2026-07-31), baseline
> `sprint1` @ **`d60397537`**. Each stream below is self-contained: ownership,
> verified findings with current line numbers, and acceptance criteria. You should
> not need to consult any other session to implement a stream.

## 🔬 COMPILED-CSS FACTS (2026-07-31) — supersedes any border reasoning in this doc

Generated from `uno.config.ts` with `unocss` rather than inferred from tokens or
config comments. **Two sessions independently got this wrong by reading the theme
file instead of the compiler output** — if a border utility's behaviour matters,
generate it. Recipe: a 10-line script importing `createGenerator` from `unocss`
plus `uno.config.ts`, run with `bun` from the repo root (`node_modules/unocss`
resolves there).

| utility | actually emits |
| --- | --- |
| `border-1` / `border-3` / `border-4` | `border-color: var(--bg-1 / --bg-3 / --bg-4)` — **COLOUR ONLY, NO WIDTH** |
| `border-b` / `border-t` / `b` | `border-bottom/top/all-width: 1px` — this is where width comes from |
| `border-b-light` / `border-t-light` | `border-bottom/top-color: rgb(246 246 246)` — **a hardcoded `#f6f6f6`; it NEVER reaches `--border-light`** |
| `border-b-base` / `border-base` / `b-base` | `border-bottom-color` / `border-color`: `var(--bg-base)` — the **page background**; it NEVER reaches `--border-base` (see the correction below) |
| `border-b-4` / `border-t-4` | `border-bottom/top-color: var(--bg-4)` ✅ the correct theme-aware fix |
| `border-b-1` | `var(--bg-1)` — the config comment claiming `--bg-3` is **wrong** |
| `border-b-2` | `var(--bg-2)` — the config comment claiming `--bg-4` is **wrong** |

**1. `--border-light` is unreachable through these utilities.** `light` is a
*palette* colour (`#f6f6f6` — `bg-light`, `text-light`, `border-light` all emit
it), and UnoCSS parses `border-b-light` as side `b` + colour `light`, **shadowing**
the config's `'b-light': 'var(--border-light)'`. The **entire** `borderColors` map
(`b-1`, `b-2`, `b-3`, `b-light`, **and `b-base`**) is dead for the same reason.
**Do not trust that block's comments.**

> **Correction (S5, 2026-07-31): `b-base` does NOT survive — it is shadowed too.**
> This section originally said `b-base` was the one live entry. Regenerated:
> `border-b-base` → `border-bottom-color: var(--bg-base)` and `border-base` /
> `b-base` → `border-color: var(--bg-base)`. `base` is also a palette colour
> (`colors.base = 'var(--bg-base)'`, `uno.config.ts:35`), so side-parsing shadows
> `'b-base': 'var(--border-base)'` exactly as it does `b-light`. **`--border-base`
> is unreachable through these utilities, and `--bg-base` is the page background** —
> so a `border-*-base` hairline is background-on-background, i.e. invisible in both
> themes, and on a surface that is not the page background it reads as a
> wrong-coloured line rather than a hairline.
>
> This matters for anyone fixing `SkillsHubSettings.tsx:542,566`
> (`border border-b-base`): that is not a working border being restyled. `border`
> gives four widths, `border-b-base` colours only the **bottom**, and the other
> three sides fall back to the preflight's `transparent` — so the intended box
> outline does not exist at all. Same defect was fixed at
> `DirectorySelectionModal.tsx:188` on `feat/ui-settings-chrome` by moving to
> `border border-4` (colour on all four sides). Verified by generation, not inferred.

**2. The `border-*-light` defect is INVERTED from what was recorded here.** Those
hairlines paint a fixed `#f6f6f6` in *both* themes: **bright/over-strong in dark
(visible, not missing) and near-invisible in LIGHT** against the pale card fill.
Any acceptance criterion of the form "confirm it is visible in dark" is therefore
backwards and will read as "no bug" — check **light** for the disappearance and
dark for the over-strong line. The fix (`border-b-4`) is still right.

**3. The preflight sets every element to `border-width: 0`** (`uno.config.ts:175`),
so a class list carrying a numeric border and **no** width utility renders **no
border at all, in either theme**. This makes **Stream 3 finding 9 worse than
written**: `MessageList.tsx:834` is `border-1 border-solid border-3` — two
competing colour declarations and zero width — so the scroll-to-bottom control has
**no border in any theme**, not merely an invisible one in dark. The author wrote
`border-1` intending 1px; it silently became a colour. The fix must **add a width**
(`b` or an explicit `1px`), not just change the colour.

~~**Unaffected / still sound:** Stream 3 finding 15 (`SendBox/index.tsx:1424`) is
`border-3 b ... b-solid` — `b` supplies the width and `border-3` the colour against
`bg-dialog-fill-0`, so it is a genuine invisible-in-dark case exactly as described.~~
Stream 5 finding 11's `--bg-3` sites are sound.

**4. ⚠️ CORRECTION (S3, after implementing): generation tells you what a class
EMITS, not whether it WINS.** The claim struck out just above was wrong, and it
was wrong in the direction this whole block exists to prevent. `.sendbox-panel`
carries an inline `style` setting `borderColor` in every state, so `border-3`
there never painted — finding 15 is **void**, not "genuine". Two rules follow,
both paid for in the running app:

- **Check for a competing inline `style` on the element** before treating a
  border utility as load-bearing. A grep for `border-3` over-reports.
- **`.arco-btn` sets `border-color: transparent`** and beats an unprefixed
  utility at equal specificity. Any finding that converts a bordered `div` into
  an Arco `Button` needs `!b !b-solid !border-4`, not the plain forms — S3's
  finding 9 measured `rgba(0,0,0,0)` before the `!` prefixes were added.

The reliable check is `getComputedStyle(el).borderColor` on the real element in
the real theme, not the generator. The generator was still worth running — it is
how the width-vs-colour split was found — but it is a first step, not the proof.

## Baseline update — 2026-07-31 (verified from origin)

`sprint1` has moved **`d30c374e6` → `d60397537`**. Branch new streams off the new
tip, and note what landed inside two streams' territory:

- **Stream 3's files changed materially.** The KB citation click-through (MR !17,
  `d60397537`) edited `Markdown/index.tsx` (custom-scheme link interception +
  `urlTransform` whitelist), `MessageText.tsx`, and `ChatConversation.tsx` (it
  mounts `KnowledgeCitationsProvider` in **both** return paths). Re-read all
  three before touching them; do not break the `weprompt-kb://` interception or
  the provider mount.
- **Stream 4's files changed materially.** `feat/kb-ui-polish` (`2b32b7908`)
  rewrote `ProjectKnowledgeCard.tsx` + `useProjectKnowledge.ts` (icon-button
  headers, passages tooltip, Embed-all, reveal-folder, Note tag removed).
- ~~**Stream 3 is also blocked on a running session:** the KB stale-chat hint
  (`feat/kb-stale-chat-hint`) is in flight and mounts a notice near the composer
  in the conversation view — same files. Start Stream 3 only after it lands.~~
  **RESOLVED** — the hint landed, S3 unblocked, implemented and shipped as
  MR !29. See the S3 status entry under Escalations.
- Streams **2, 4, 5** are unaffected by anything in flight and can start now.
- The whole KB epic is merged; no KB branch has unmerged commits.
- ⚠️ **Do not branch off the LOCAL `sprint1`.** The main checkout
  (`/Users/lap16603/Projects/WePrompt`) was sitting at `f046b8796`, which is **9
  commits behind** `origin/sprint1` — `f046b8796` is an *ancestor* of
  `d60397537`, not newer, so it silently lacks the citation click-through and the
  KB UI polish. `git fetch origin` first (needs VPN) and branch off
  **`origin/sprint1`**, then confirm with
  `git log --oneline -1` that you are on `d60397537` or later. A stream started
  from the stale local tip will "fix" findings that no longer exist and conflict
  on files that were already rewritten.

**Findings status: dispatch-ready.** Each of Streams 2–5 now carries a
`#### Findings — verified against d60397537` subsection below, produced by
re-checking every finding against a clean worktree at that tip, then auditing the
result twice. **41 actionable (S2 7 / S3 15 / S4 11 / S5 8), 1 needing a decision
before it can start (Stream 5 #8), 3 void.** Stream 3 finding 15 was found by the
second audit rather than the original survey. Every `path:line` in those sections was re-derived at this tip — the
verification moved most of them and widened several (e.g. the Stream 2 keyboard
finding grew from 2 cited files to 14 sites), so **trust the doc over any older
list**, including anything remembered from the session that first surveyed them.

### Notes back to whoever dispatches these

Four things that need a human, written here because the producing session could
not reach the dispatching session directly:

1. **One ownership call to sanity-check.** Stream 2 finding 4 needs a 2-line
   change to `pages/team/hooks/useTeamList.ts` (expose `isLoading`). Protocol
   rule 3 would force it to stop and escalate, which a solo session cannot
   resolve, so that **single file** is granted to Stream 2 in its owns list.
   Nothing else claims it. Move it elsewhere if you disagree.
2. **Stream 5 #8 needs a decision, not an implementer.** Its acceptance is
   "migrate every site, or write the two-chrome rule down" — a policy call. It is
   excluded from Stream 5's actionable count. Answer it before dispatching S5, or
   tell the implementer to skip it.
3. **A dark-mode defect was found that reaches beyond these streams.**
   `--bg-3` is nominally the border token but in dark equals `--dialog-fill-0`
   (`#1e2536`), so any hairline drawn with `border-3` on a card or dialog is
   invisible. Confirmed twice: the template gallery (fixed in Stream 1 with
   `border-4`) and now the composer's own outline
   (`SendBox/index.tsx:1424`, Stream 3 finding 15). **Only Streams 1 and 3 have
   been swept** — if you own other surfaces, grep them for `border-3`.
   **Update (S3, 2026-07-31):** the composer half of this is **void** — an inline
   `borderColor` overrides the class there, so it was never invisible; see
   finding 15. The trap itself is real (S1's gallery, S5's dialog fills), but
   grepping for `border-3` over-reports: check for a competing inline style, and
   check the actual surface, before believing a hit. S3's and S5's sweeps are
   both now complete; **S4 is the one still unswept**.
4. ~~**Stream 3's findings are written but its BLOCKED status is unchanged** — the
   stale-chat hint is still in flight in the same files. Findings are ready the
   moment it lands.~~ **RESOLVED — S3 shipped, MR !29.**

Housekeeping: the verification worktree used to produce these findings was
removed. To recreate a clean read-only tree at this tip:
`git worktree add --detach .claude/worktrees/<name> d60397537` (no `bun install`
needed for grep/read verification).

## Session protocol (every stream)

1. Work in your own worktree + branch off `sprint1` (`feat/ui-<stream>`). Run
   `bun install` in the worktree before trusting any red gate.
2. `origin` (code.vng.vn) needs VPN. If fetch fails, cached `origin/sprint1`
   refs are usable but may be stale — say so in the MR description.
3. Touch ONLY files in your stream's "owns" list. If a fix seems to need a file
   outside it, stop and leave a note in this doc under "Escalations" instead.
4. i18n: prefer REUSING existing keys (`common.close` exists —
   `locales/en-US/common.json:30`). Add new keys only inside your stream's
   designated block (table below). All 12 locales, `bun run i18n:types`,
   `node scripts/check-i18n.js`.
5. `uno.config.ts` is FROZEN for all streams. Border tokens `border-1..4`
   (→ `--bg-1..4`) and `text-t-secondary` already exist — use them.
6. Gate before MR: `bun run lint:fix && bun run format && bunx tsc --noEmit`,
   tests for changed behavior, i18n checks above. No AI signatures in commits.
7. **Several findings can only be accepted by eye, in both themes.** jsdom
   computes no layout and no colour, so any finding whose acceptance mentions a
   focus ring, a divider, a collapsed rail or "invisible in dark mode" needs the
   real app: `bun run dev` from your worktree (`package.json:16`). Only ONE
   instance can run at a time (`app.requestSingleInstanceLock`) — if another
   session already has one up, use `bun run start:multi` instead, which isolates
   to `~/.aionui-dev-2` (fresh env: no providers/keys, which is fine for pure UI
   checks). To switch theme without hunting for the toggle, drive the renderer
   over CDP on port **9230**: `Emulation.setEmulatedMedia` with
   `prefers-color-scheme`, plus
   `document.documentElement.setAttribute('data-theme','dark')` — the app's theme
   toggle stamps `data-theme` on the root element and it must win in both
   directions. Verify the CDP target's URL matches YOUR vite port before driving
   it, so you never puppet another session's window.
8. **Check whether the file you are editing even has `t` in scope.** Several
   findings add an i18n'd `aria-label` to components that import no
   `react-i18next` at all — e.g. `Sider/SiderItem.tsx` has zero `useTranslation`
   / `t(` occurrences, and `ChatLayout/WorkspacePanelHeader.tsx` is a prop-only
   arrow component. Adding the hook (or threading a prop) is part of those fixes.
9. **Grep before minting an i18n key — a similar name may already exist under a
   different namespace.** `moreActions` is a real key at
   `locales/en-US/conversation.json:592`, but it lives under `commandQueue`, not
   `conversation.history`. A grep for the bare word will hit it and tempt you to
   wire the wrong key. Confirm the full dotted path, not the leaf.

## Merge / rebase rules (the two known conflict points)

- **`packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts` is generated
  AND committed.** Every stream that adds a key rewrites it → it WILL conflict
  between streams. Never hand-merge it: on rebase, take either side, re-run
  `bun run i18n:types`, commit the regenerated file.
- **`locales/*/conversation.json` is shared by Streams 1–4** (templates,
  sidebar, messages, and project keys ALL live there), × 12 locales.
  `scripts/check-i18n.js` does NOT detect duplicate keys and `JSON.parse` is
  last-wins, so a bad text-merge fails SILENTLY (this exact failure shipped a
  duplicate `projectHeader` block during the Khoa merge). On rebase conflicts in
  any locale JSON: take the incoming file wholesale, re-apply your own block by
  hand, then eyeball-check your block name appears exactly once.
- Land order suggestion: smallest-first (5 → 1 → 2 → 4 → 3). Whoever lands
  later rebases and follows the two rules above.

## Locale-block assignments (conversation.json unless noted)

| Stream | Adds keys under | Notes |
| --- | --- | --- |
| 1 | `presentationTemplates.*` | rename `importCard` value, don't rename the key without checking all 12 locales |
| 2 | `conversation.history.*` / existing sidebar blocks, **plus `team.json`** | reuse `common.close` for the search-popover close. Finding 4 adds `team.sider.empty` to `team.json` ×12 — a different file from `conversation.json`, so it does not touch the shared-file landmine |
| 3 | existing message blocks (`messages.json` / `conversation.json` message keys) | new: plan-badge, Input/Output labels |
| 4 | existing project blocks (`project*`, `knowledge*`) | new: showLess, retry-explanation |
| 5 | `settings.json`, `mcp.json`, `common.json`, **`fileSelection.json`** | sole owner of new `common.*` keys; others only REUSE. Finding 4 adds `fileSelection.emptyFolder` to `fileSelection.json` ×12. **Stream 5 must NOT add keys to `conversation.json`** — one finding offers it as an option; decline, because that file is the shared silent-duplicate-key landmine described above |

## Stream ownership (file-level where directories nest)

### Stream 1 — Templates panel — ✅ DONE (branch `feat/ui-templates-panel`)
Three commits, verified live in light + dark and in de-DE. Unpushed, no MR yet.
- `bdeed81b5` one shelf per format (was two layouts at once), dark-mode card and
  panel borders, header button weight.
- `f90e2cdb1` rewrote all 12 built-in template descriptions and localized their
  names + descriptions into all 12 locales (288 strings) behind
  `useTemplateLabels`, plus `importCard` "theme"→"template" and `columnHtml`
  "Reports"→"Web".
- `3e1a072b6` group headings now outrank the card names under them (they were
  both 12px with the heading *lighter*), gap-based grouping, and an
  overflow-conditional edge fade + per-group count so templates hidden past a
  shelf edge are discoverable.

Gate: typecheck, lint, format and i18n clean; the three gallery suites green (18
tests). The **full suite has not completed since `3e1a072b6`** — the machine was
running three other vitest suites (load ~24) and this one accumulated 19s of CPU
in 17 minutes before being stopped. Run `bun run test` when the box is quiet
before opening the MR.

Rebase onto `d60397537` is **verified conflict-free** via
`git merge-tree --write-tree`, and the merged tree was checked key-by-key: all 12
locales keep `catalog` (12 entries each) plus the incoming KB keys, with **no
duplicate keys** — the silent failure mode described under "Merge / rebase rules".
Regenerate `i18n-keys.d.ts` after the rebase regardless.
Owns: `renderer/components/chat/TemplateGallery/**`,
`tests/unit/renderer/TemplateGalleryColumns.dom.test.tsx`,
`tests/unit/renderer/useTemplateLabels.dom.test.tsx`,
`tests/unit/chat/templateGalleryPanel.dom.test.tsx`,
`process/resources/presentation-templates/index.ts`, and — conditionally, container
styles only — `pages/guid/GuidPage.tsx` (it renders `TemplateGalleryExpanded` at
:765; no other stream owns it). GuidPage ended up NOT needing changes.
MUST NOT change: the gallery's **public API** — `index.ts` exports, and the
props of `TemplateMessageCard` (rendered by Stream 3's `MessageText.tsx:26`),
`TemplateGalleryButton`, and `directive.ts` (imported by
`utils/chat/templatedSendParser.ts`). Internal rendering inside those files IS
Stream 1's to change and was: `TemplateMessageCard`/`TemplateChipCard` now
resolve their label through `useTemplateLabels`. No other stream edits those
files, so there is no conflict — the constraint is the contract, not the file.
Also off-limits: `SendBox/index.tsx` (hosts `templateGalleryNode`; Stream 3's).
Landed notes for later streams:
- `useTemplateLabels` (exported from `usePresentationTemplates.ts`) is the only
  correct way to display a built-in template's name/description. It lives in
  that hook file rather than its own module because the directory is at the
  10-child limit from the architecture guide.
- Template cards are now `role='button' tabIndex=0` with Enter/Space; their
  preview `<img>` is `alt=''` because the card carries the accessible name.
  Tests must query by role+name, not alt text.

### Stream 2 — Sidebar & history — ✅ MR !24 OPEN (branch `feat/ui-sidebar-history`)
All 7 findings; 6 commits rebased onto `cf7035dfe`, pushed, MR !24 into `sprint1`.
Full suite green (506 files / 4633 tests). Verified live with focus emulation:
31/31 conversation rows focusable, 36 `role=button` rows in the sidebar, focus
outline confirmed painting, and every sidebar row measured at a uniform 34px.

**Reusable discoveries for the other streams:**
- ⚠️ **Numeric Uno utilities are hijacked into colours beyond `border-*`.** The
  theme merges its numeric background scale into `theme.colors`, so `outline-1`
  compiles to `outline-color: var(--bg-1)` and `ring-2` to
  `--un-ring-color: var(--bg-2)` — **neither sets a width**. If you need a focus
  ring or any outline, declare it as one arbitrary property
  (`focus-visible:[outline:1px_solid_rgb(var(--primary-6))]`). Generate the CSS
  before trusting a width utility.
- `focus-visible:bg-fill-3` reaches the stylesheet and its token resolves, yet the
  computed background stays transparent on every sidebar row with no competing
  rule. Don't reach for it; use an outline.
- A reusable helper now exists at
  `renderer/utils/ui/rowActivation.ts` (`activateOnEnterOrSpace`,
  `ROW_FOCUS_RING`) — Streams 3/4/5 should import it rather than re-inlining
  Enter/Space handlers. That directory was unclaimed and had room under the
  10-child rule.
- Arco's `Message` mounts via the legacy `ReactDOM.render` that React 18 removed;
  any test that triggers it must stub it or the test throws an unhandled error.
- `useConversationListSync` keeps state in module-level `let` bindings, so a test
  that needs a fresh store must `vi.resetModules()` + re-import; otherwise flags
  leak between cases.

Owns: `renderer/pages/conversation/GroupedHistory/**` (incl. `hooks/`),
`renderer/components/layout/Sider/**`, and — granted explicitly to resolve finding 4 —
`renderer/pages/team/hooks/useTeamList.ts` (2-line change: expose `isLoading`; no other
stream claims this file). Without this grant, protocol rule 3 would force finding 4 to
stop and escalate, which a solo session cannot resolve.
MUST NOT touch: `components/layout/Layout.tsx`, `WindowControls.tsx` (Stream 5 —
same parent dir, different files), or anything else under `pages/team/**`.



#### Findings — verified against `d60397537`

**7 actionable, 0 void.** Every `path:line` below was re-checked at this tip; trust these over any older list.

> Numbering is stable: it reflects the original verification order, so a number is never reused. Void items keep their number and are listed at the end — if the notes below reference `#N`, that is this numbering.

> **Stream notes:** All 7 findings survive at sprint1 tip d60397537; none are ALREADY_FIXED and no file is gone. SiderItem.tsx:57-67 and ConversationSearchPopover.tsx:515 (finding 6) are the citations whose line numbers were still exact; the rest shifted as files grew. Nothing in components/layout/Layout.tsx or WindowControls.tsx is reported (Stream 5), though Layout.tsx:351 is a valid in-repo role/tabIndex reference if the implementer wants a third example. Two cross-stream touch points a cold session must know about: 1. Finding 3's fix necessarily reads packages/desktop/src/renderer/hooks/context/ConversationHistoryContext.tsx (no code change required — `ConversationHistoryContextValue = ReturnType<typeof useConversationListSync>` spreads new fields automatically at :29-33), and Finding 4's fix necessarily edits packages/desktop/src/renderer/pages/team/hooks/useTeamList.ts:14,61, which lives outside this stream's owned directories. Coordinate if another stream also touches useTeamList. 2. useConversationListSync.ts keeps all state in module-level `let` bindings (:110-130). Any test added for the new loaded flag must account for state leaking across test cases in the same file. Out-of-scope convention violations noticed while verifying, NOT reported as findings: ConversationSearchPopover.tsx:430 and :511 use raw `<button type='button'>` rather than an Arco component, which contradicts the "no raw interactive HTML" rule. If Finding 6 is fixed by touching :515, a reviewer may flag the surrounding raw button — decide deliberately whether to convert (converting :511 to an Arco Button risks the same `.arco-btn` display conflict documented at GroupedHistory/index.tsx:672-675, and the button is styled entirely by `.conversation-search-modal__close-btn` in ConversationSearchPopover.css). The known dark-mode --bg-3 trap did not apply to any of these seven fixes: none of them draws a new border. The only border tokens in scope resolve through `var(--color-border-2)` (Sider/index.tsx:232, SiderFooter.tsx:62), which is unaffected.

##### 1. Sidebar rows are <div onClick> with no role/tabIndex/onKeyDown — primary navigation is unreachable by keyboard

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** medium
- **Where:**
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx:280`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx:293`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderItem.tsx:57`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderItem.tsx:65`
  - `packages/desktop/src/renderer/components/layout/Sider/TeamSiderSection.tsx:121`
  - `packages/desktop/src/renderer/components/layout/Sider/TeamSiderSection.tsx:127`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderNav/SiderToolbar.tsx:29`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderNav/SiderToolbar.tsx:52`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderNav/SiderDashboardEntry.tsx:34`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderNav/SiderDashboardEntry.tsx:55`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderNav/SiderAssistantEntry.tsx:34`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderNav/SiderAssistantEntry.tsx:55`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderNav/SiderScheduledEntry.tsx:34`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderNav/SiderScheduledEntry.tsx:55`
- **Problem:** SiderItem.tsx:57-67 is EXACTLY as cited (unchanged). ConversationRow.tsx shifted: the row element is now at :280-295 (`<div id={'c-' + conversation.id} className={classNames('chat-history__item h-34px rd-8px flex items-center group cursor-pointer ...')} onClick={handleRowClick} onContextMenu={handleRowContextMenu}>`) — no `role`, no `tabIndex`, no `onKeyDown`. Same for SiderItem.tsx:57 (`<div className={classNames('h-34px rd-8px flex items-center gap-8px pl-10px pr-8px cursor-pointer relative ...')} onClick={onClick} onContextMenu={onContextMenu}>`). Verification also found the SAME defect on every other row in the same vertical stack, so fixing only the two cited files leaves the rail half-navigable: the collapsed team row (TeamSiderSection.tsx:121 `<div data-testid={`collapsed-team-item-${team.id}`} ... onClick={() => handleTeamClick(team.id)}>`), both new-chat triggers (SiderToolbar.tsx:29 collapsed, :52 expanded), and the Dashboard/Assistant/Scheduled nav entries (each has a collapsed div at :34 and an expanded div at :55, both `onClick={onClick}` only). Note SortableConversationRow.tsx:43 already sets `role='button'` + `aria-label` on the *drag handle* only — the row itself is still not focusable. SiderFooter.tsx:65-108 correctly uses Arco `<Button>` and is already focusable.
- **Done when:** Every clickable sidebar row exposes `role='button'`, `tabIndex={0}`, an `aria-label` (or accessible text content) and an `onKeyDown` that calls the same handler as `onClick` for `event.key === 'Enter' || event.key === ' '` with `event.preventDefault()`. Concretely: (1) ConversationRow.tsx:280 gains `role='button' tabIndex={0} aria-label={conversationName} onKeyDown={...handleRowClick}`; (2) SiderItem.tsx:57 gains `role='button' tabIndex={0} aria-label={name} onKeyDown={...onClick?.()}`; (3) TeamSiderSection.tsx:121, SiderToolbar.tsx:29 and :52, SiderDashboardEntry/SiderAssistantEntry/SiderScheduledEntry .tsx:34 and :55 all gain the same four attributes. Keyboard check: Tab reaches every row in the sidebar in visual order and Enter/Space navigates. Add a visible focus ring using semantic tokens only (e.g. `focus-visible:bg-fill-3` / `focus-visible:outline-1 focus-visible:outline-[var(--color-border-2)]`) — no hardcoded hex. Do not convert these to Arco `<Button>`: the rows carry absolutely-positioned overlays and `group-hover` children that `.arco-btn`'s own `display` rule breaks (see the comment at GroupedHistory/index.tsx:672-675).
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/conversation/Workspace/components/FileChangeList.tsx:112 — role/tabIndex/onKeyDown Enter+Space with preventDefault on a clickable div; also packages/desktop/src/renderer/pages/conversation/components/ConversationTitleMinimap/index.tsx:233 for the same pattern plus an i18n aria-label.
- **Testing:** tests/unit/renderer/ConversationRow.dom.test.tsx and tests/unit/renderer/team/TeamSiderSection.dom.test.tsx already render these with jsdom + @testing-library/react (react-i18next is mocked to return the key). Add `fireEvent.keyDown(el, { key: 'Enter' })` assertions on `screen.getByRole('button', { name: ... })` and assert the click handler mock fired. jsdom does not compute real focus rings, so assert attributes (`toHaveAttribute('tabindex','0')`) rather than visual focus.

##### 2. Per-row overflow (...) actions are display:none until mouse hover — no group-focus-within, so pin/rename/delete/export are mouse-only

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** medium
- **Where:**
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx:341`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx:347`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx:420`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx:426`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderItem.tsx:96`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderItem.tsx:99`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderItem.tsx:132`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderItem.tsx:138`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx:676`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx:698`
- **Problem:** Still true at every cited site, lines shifted. ConversationRow.tsx has the class on TWO nested elements: the wrapper div at :341-349 (`'hidden group-hover:flex': !isMobile && !menuVisible` at :347) and the `MoreOne` trigger span at :420-428 (same conditional at :426). SiderItem.tsx mirrors it exactly: wrapper at :96-100 (`'hidden group-hover:flex'` at :99) and trigger span at :132-140 (:138). Project-group rows moved from the cited 659-706 to GroupedHistory/index.tsx:676-681 (new-chat action) and :698-703 (overflow Dropdown) — both are `<span className={classNames('items-center justify-center', isMobile ? 'flex' : 'hidden group-hover:flex')}>` wrappers around real Arco `<Button>`s; because the wrapper resolves to `display:none`, the otherwise-focusable Buttons are removed from the tab order entirely. No `group-focus-within` variant appears anywhere in the **sidebar itself** — the only `GroupedHistory/**` hit is `ConversationSearchPopover.css:177`, a search-input rule. (An earlier draft of this line went further and claimed there was no precedent anywhere in the repo. That was wrong: three live `group-focus-within` sites exist — see 'Copy this in-repo pattern' below. You are porting an existing idiom into the sidebar, not inventing one.)
- **Done when:** Add `group-focus-within:flex` alongside every `group-hover:flex` on the six wrapper/trigger sites so the action cluster becomes visible when any descendant receives focus, AND make the trigger itself focusable so focus can land there: the `<span data-testid={`conversation-row-menu-${id}`}>` at ConversationRow.tsx:420 and the `<span data-testid='sider-item-menu-trigger'>` at SiderItem.tsx:132 need `role='button' tabIndex={0} aria-label={t('conversation.history.moreActions')}` (add the key to all 12 locales if missing) plus an `onKeyDown` for Enter/Space that opens the dropdown. For the project rows, keep the Arco `<Button>`s but change the wrapper spans at index.tsx:676 and :698 from `'hidden group-hover:flex'` to `'hidden group-hover:flex group-focus-within:flex'` — the Buttons already carry `aria-label` (:684, :712) and are natively focusable once the wrapper is displayed. Acceptance: with the mouse untouched, Tab into a conversation row then Tab again reaches the (...) trigger, it is visible, and Enter opens the pin/rename/delete menu. Also verify the parent that owns the `group` class is the row itself (ConversationRow.tsx:283 has `group`; SiderItem.tsx:59 has `group`; the project row's `group` comes from WorkspaceCollapse) — `group-focus-within` only works if the focused element is inside that same group element.
- **Copy this in-repo pattern:** Three live `group-focus-within` precedents exist (an earlier draft of this doc wrongly said none did): `packages/desktop/src/renderer/pages/conversation/components/ChatTitleEditor.tsx:106` and `:87` (nearest neighbour — same directory family, and the file this stream already cites for the toggle idiom), and `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:339` (`opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100`) — literally the shape this finding needs. Copy one of those; do not invent a new idiom.
- **Testing:** tests/unit/renderer/sidebarProjectRowActions.dom.test.tsx already mounts the project rows with mocked router/i18n/LayoutContext; tests/unit/renderer/ConversationRow.dom.test.tsx covers the row. jsdom does not evaluate UnoCSS-generated CSS, so do NOT assert computed visibility — assert the className contains `group-focus-within:flex`, and assert behaviour with `fireEvent.focus` + `fireEvent.keyDown(trigger, { key: 'Enter' })` that the menu opens (`screen.getByText('conversation.history.rename')`).

##### 3. Cold start flashes the "No chat history" Empty state because the history store snapshot has no loaded/initialized flag

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** medium
- **Where:**
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx:742`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx:753`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync.ts:102`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync.ts:112`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync.ts:113`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync.ts:124`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync.ts:132`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync.ts:154`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync.ts:188`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync.ts:198`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync.ts:539`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversations.ts:60`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversations.ts:219`
  - `packages/desktop/src/renderer/hooks/context/ConversationHistoryContext.tsx:29`
- **Problem:** Still true; lines shifted. The Empty render moved from the cited 730-734 to GroupedHistory/index.tsx:753-757 — `{conversationOnlySections.length === 0 ? (<div className='py-48px flex-center'><Empty description={t('conversation.history.noHistory')} /></div>) : null}` — and the section is entered on a cold start because the gate at :742-743 is `(conversationOnlySections.length > 0 || (timelineSections.length === 0 && pinnedConversations.length === 0))`, which is true when nothing has loaded. The store still cannot distinguish "empty" from "not loaded": `conversationsState: TChatConversation[] = []` at useConversationListSync.ts:113, the snapshot type at :102-108 and the initial `snapshotState` at :124-130 contain only conversations + the four status maps, and the one existing flag `isStoreInitialized` (:112) is a module-scope guard for wiring listeners (:402-408), never surfaced to React. The `getUserConversations` invoke is now at :154 (was :155). Both failure paths (:188 and :198) also reset to `[]`, so a load error is indistinguishable from empty.
- **Done when:** A correct fix touches four files: (1) useConversationListSync.ts — add `hasLoadedConversations: boolean` to `ConversationListSyncSnapshot` (:102-108), initialise it `false` in `snapshotState` (:124-130), keep a module-level `hasLoadedConversationsState = false`, set it `true` in all three terminal branches of `refreshConversations` (success :184, empty-result :190, catch :200) BEFORE `emitStoreChange`, and include it in the object built by `emitStoreChange` (:132-141); return it from the hook (:539-547). (2) hooks/context/ConversationHistoryContext.tsx — nothing to change, `ConversationHistoryContextValue = ReturnType<typeof useConversationListSync>` and the spread at :29-33 forwards it automatically. (3) useConversations.ts — destructure the new field at :60-69 and add it to the returned object at :219-231. (4) GroupedHistory/index.tsx — gate the Empty at :753 on `hasLoadedConversations && conversationOnlySections.length === 0`, and while `!hasLoadedConversations` render either nothing or a skeleton of the same 48px vertical footprint so the rail does not jump. Done when: launching with a populated history never paints "No chat history" (verify by throttling/deferring the `ipcBridge.database.getUserConversations` mock resolution in a test and asserting the string is absent on first paint), and a genuinely empty history still shows it after load resolves.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/hooks/file/useUploadState.ts:22 — a boolean (`isUploading`) carried inside a `useSyncExternalStore` snapshot type and recomputed on every emit; the same shape works for `hasLoadedConversations`.
- **Testing:** tests/unit/renderer/conversation/useConversationListSync.dom.test.ts already mocks `ipcBridge.database.getUserConversations` — add a case that resolves the invoke on a deferred promise and asserts `hasLoadedConversations === false` before and `true` after, including the catch path. For the UI gate, tests/unit/renderer/sidebarChatsControls.dom.test.tsx renders the history; assert `queryByText('conversation.history.noHistory')` is null pre-resolution. The module-level state in useConversationListSync.ts is shared across tests — the existing test file's reset approach must be followed or the flag will leak between cases.

##### 4. Team sidebar section has neither an empty state nor a loading state — expanding shows a header over a blank gap

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/components/layout/Sider/TeamSiderSection.tsx:202`
  - `packages/desktop/src/renderer/components/layout/Sider/TeamSiderSection.tsx:203`
  - `packages/desktop/src/renderer/pages/team/hooks/useTeamList.ts:14`
  - `packages/desktop/src/renderer/pages/team/hooks/useTeamList.ts:61`
- **Problem:** Still true; moved from the cited 190-191 to TeamSiderSection.tsx:202-203: `{expanded && sortedTeams.length > 0 && sortedTeams.map((team) => { ... })}`. When `sortedTeams` is empty the expanded section renders only the sticky label row (:162-201) followed by nothing, and there is no way to tell "you have no teams" from "still fetching". The data source cannot report either: useTeamList.ts:14 is `const { data: teams = [], mutate } = useSWR<TTeam[]>(...)` — `isLoading` is never destructured — and the hook returns only `{ teams, mutate, removeTeam }` at :61. The `[]` default means the first render is indistinguishable from a real empty list.
- **Done when:** Two edits. (1) packages/desktop/src/renderer/pages/team/hooks/useTeamList.ts — destructure `isLoading` from `useSWR` at :14 and add it to the returned object at :61 (`return { teams, isLoading, mutate, removeTeam };`). (2) TeamSiderSection.tsx:202-203 — replace the `sortedTeams.length > 0 &&` short-circuit with a three-branch render inside `{expanded && (...)}`: when `isLoading && sortedTeams.length === 0` render a centred Arco `<Spin size={16} />` in a `h-34px` row (matching SiderItem row height); when `!isLoading && sortedTeams.length === 0` render a single non-interactive `h-34px` row with `pl-10px text-13px text-t-secondary` showing a new i18n key `team.sider.empty` ("No teams yet") — the key does not exist today and must be added to all 12 locale files at packages/desktop/src/renderer/services/i18n/locales/<locale>/team.json under `sider`; otherwise render the existing list. No hardcoded strings, no hardcoded colors. Done when: expanding with zero teams shows the localized empty line, and expanding during the initial SWR fetch shows the spinner rather than a gap.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/components/layout/Sider/TeamSiderSection.tsx:134 already renders `<Spin size={16} />` inline for a running team, so reuse that exact spinner size. For the loading/empty split pattern in a list, packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/TaskDetailPage.tsx already imports both `Spin` and `Empty` from Arco for the same purpose; the sidebar variant should be a single text row rather than Arco `<Empty>`, which is far too tall for a 240px rail (compare the full-size usage at GroupedHistory/index.tsx:755).
- **Testing:** tests/unit/renderer/team/TeamSiderSection.dom.test.tsx and tests/unit/renderer/layout/TeamSiderSection.dom.test.tsx both already mock `useTeamList`; add cases returning `{ teams: [], isLoading: true }` and `{ teams: [], isLoading: false }` and assert the spinner vs `screen.getByText('team.sider.empty')` (i18n is mocked to echo keys). Also run `node scripts/check-i18n.js` and `bun run i18n:types` after adding the key.

##### 5. Collapsed-rail item heights are inconsistent: team items h-40px vs h-34px for every sibling (and h-32px for the collapsed search entry)

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/components/layout/Sider/TeamSiderSection.tsx:124`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderNav/SiderToolbar.tsx:31`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderNav/SiderDashboardEntry.tsx:36`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderNav/SiderAssistantEntry.tsx:36`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderNav/SiderScheduledEntry.tsx:36`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderNav/SiderSearchEntry.tsx:39`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx:283`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderItem.tsx:59`
- **Problem:** Still true; cited lines were TeamSiderSection.tsx:121 and SiderToolbar.tsx:30-31 / ConversationRow.tsx:279. Current: the collapsed team item is `'relative w-full h-40px flex items-center justify-center cursor-pointer transition-colors rd-8px'` at TeamSiderSection.tsx:124, while every other row in the same `flex flex-col gap-2px` stack (composed at components/layout/Sider/index.tsx:187-253) is 34px: SiderToolbar.tsx:31 collapsed new-chat `w-full h-34px`, SiderDashboardEntry.tsx:36, SiderAssistantEntry.tsx:36, SiderScheduledEntry.tsx:36 (all `w-full h-34px ... rd-8px`), ConversationRow.tsx:283 `h-34px rd-8px`, SiderItem.tsx:59 `h-34px rd-8px`. Verification surfaced a THIRD value the original finding missed: SiderSearchEntry.tsx:39 overrides the popover trigger to `!h-32px` in the collapsed branch (the trigger's own base class at ConversationSearchPopover.tsx:423 is `h-34px w-34px`), so the collapsed rail currently renders 40 / 34 / 32px rows adjacent to each other.
- **Done when:** Every row in the collapsed rail is `h-34px` with `rd-8px`. Concretely: change `h-40px` to `h-34px` at TeamSiderSection.tsx:124, and drop the `!h-32px` override at SiderSearchEntry.tsx:39 (leave the rest of that buttonClassName intact) so the popover trigger keeps its base `h-34px` from ConversationSearchPopover.tsx:423. Do not introduce a new token or change uno.config.ts. Done when a screenshot of the collapsed sidebar with at least one team, one pinned chat and the nav entries shows uniform row pitch (34px + the 2px stack gap) and the 16px icons stay optically centred.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/components/layout/Sider/SiderNav/SiderDashboardEntry.tsx:36 — `'w-full h-34px flex items-center justify-center cursor-pointer transition-colors rd-8px text-t-primary'` is the canonical collapsed-rail row; copy it verbatim.
- **Testing:** tests/unit/renderer/team/TeamSiderSection.dom.test.tsx already queries `collapsed-team-item-${id}` via data-testid — assert the className contains `h-34px` and not `h-40px`. jsdom will not compute the real pixel height (UnoCSS classes are not applied), so a className assertion is the only meaningful automated check; confirm the visual result by running the app collapsed.

##### 6. Hardcoded English aria-label='Close' on the search modal close button

- **Status:** `HOLDS` — holds exactly as originally found
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationSearchPopover.tsx:515`
- **Problem:** Exactly as cited (~:515, now precisely :515). The close control is `<button type='button' className='conversation-search-modal__close-btn' onClick={handleClose} aria-label='Close'>` at :511-518 — the only remaining hardcoded user-facing literal in the file. The sibling the finding mentioned is indeed already fixed: the trigger uses `aria-label={triggerAriaLabel}` at :432, with `const triggerAriaLabel = t('conversation.historySearch.tooltip')` at :322. The `title={leadingMark.label}` attributes at :108 and :118 are dynamic data, not literals. `common.close` exists in all 12 locale files (verified: every services/i18n/locales/*/common.json has a `"close"` entry).
- **Done when:** Replace `aria-label='Close'` at ConversationSearchPopover.tsx:515 with `aria-label={t('common.close')}` — `t` is already in scope in this component. No locale files need editing (`common.close` = "Close" already present in all 12). Done when `grep -n "aria-label='" packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationSearchPopover.tsx` returns no hardcoded string literal, and `node scripts/check-i18n.js` still passes.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationSearchPopover.tsx:322 and :432 — the already-fixed trigger in the same file resolves its aria-label through `t()`.
- **Testing:** No test needed beyond `node scripts/check-i18n.js`; if one is wanted, tests/unit/renderer/sidebarChatsControls.dom.test.tsx mocks i18n to echo keys, so `screen.getByLabelText('common.close')` asserts the change.

##### 7. Destructive deletes still use orange/warning instead of the settled red danger styling

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts:101`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts:135`
  - `packages/desktop/src/renderer/components/layout/Sider/TeamSiderSection.tsx:261`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx:407`
  - `packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx:406`
  - `packages/desktop/src/renderer/components/layout/Sider/SiderItem.tsx:115`
- **Problem:** All three cited sites still disagree, at shifted lines, and verification found three more in the same stream. Cited: useConversationActions.ts:101 (single-conversation delete `Modal.confirm({ ..., okButtonProps: { status: 'warning' } })`, was :99), useConversationActions.ts:135 (batch delete, same, was :133), TeamSiderSection.tsx:261 (team delete `Modal.confirm({ title: t('team.sider.deleteConfirm'), ..., okButtonProps: { status: 'warning' } })`, was :234). Additional sites in scope: GroupedHistory/index.tsx:407 — the batch-delete trigger `<Button ... status='warning' onClick={handleBatchDelete}>{t('conversation.history.batchDelete')}</Button>`; ConversationRow.tsx:406 — the delete menu item is `<div className='flex items-center gap-8px text-[rgb(var(--warning-6))]'>` with the DeleteOne icon; SiderItem.tsx:115 — `'text-[rgb(var(--warning-6))]': item.danger`, i.e. the generic danger flag renders ORANGE, so the team delete item that TeamSiderSection.tsx:221 explicitly declares `danger: true` paints warning-orange. The same team-member-removal action already uses red on the team page (pages/team/TeamPage.tsx:597 `okButtonProps: { status: 'danger' }`), and the removeProject flow in this very stream is already correct (GroupedHistory/index.tsx:533-541 `status='danger' type='outline'`, and the menu item at :640 `className='!text-danger-6'`), so this is an internal inconsistency, not a house style.
- **Done when:** All six sites switch to red: (1) useConversationActions.ts:101 and :135 → `okButtonProps: { status: 'danger' }`; (2) TeamSiderSection.tsx:261 → `okButtonProps: { status: 'danger' }`; (3) GroupedHistory/index.tsx:407 → `status='danger'` on the batch-delete Button; (4) ConversationRow.tsx:406 → replace `text-[rgb(var(--warning-6))]` with `text-danger-6`; (5) SiderItem.tsx:115 → replace `'text-[rgb(var(--warning-6))]': item.danger` with `'text-danger-6': item.danger`. `text-danger-6` is a valid generated utility (uno.config.ts:131 `/^(bg|text|border)-(primary|success|warning|danger)-([1-9])$/`) and is the token already used at GroupedHistory/index.tsx:640. Keep Modal.confirm for containers (project/team) per the settled rule — no Popconfirm conversions needed here. Done when `grep -rn "status: 'warning'\|status='warning'\|warning-6" packages/desktop/src/renderer/pages/conversation/GroupedHistory packages/desktop/src/renderer/components/layout/Sider` returns nothing on a delete path, and the confirm dialogs plus both delete menu items render red in light and dark.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:119 — container delete via `Modal.confirm` with `okButtonProps: { status: 'danger' }`, exactly the settled pattern; and packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx:640 — `<Menu.Item key='remove' className='!text-danger-6'>` for a red destructive menu item in the same file being fixed.
- **Testing:** tests/unit/renderer/conversation/ConversationRowCronMenu.dom.test.tsx and tests/unit/renderer/team/TeamSiderSection.dom.test.tsx already open these menus; assert the delete item's className contains `text-danger-6`. Arco's `Modal.confirm` renders into document.body — the existing tests pass `getPopupContainer: () => document.body`, so `okButtonProps` can be asserted by spying on `Modal.confirm` (vi.spyOn) and checking the argument object rather than by querying rendered DOM, which is more robust in jsdom.

### Stream 3 — Message rendering & composer — ✅ MERGED (MR !29, branch `feat/ui-messages-composer`)

**MERGED into `sprint1` 2026-07-31 as `ba0b6e54b`. This closes the epic — all
five streams are in.**

**All 16 findings implemented; 10 commits, finally rebased onto `sprint1@86342ce97`
(post-!28). Gate green via `just push`: 0 lint errors, format clean, tsc clean,
i18n in sync, and 516 files / 4715 tests passing.** Both rebases (onto `759292eee`
then `86342ce97`) were conflict-free.

**The shared-locale landmine never went off, verified on the merge commit itself**
(not just pre-merge): all 12 `conversation.json` parsed with a duplicate-detecting
hook — zero duplicate keys, and `emptyChat` / `chat.stopGenerating` /
`projectHome` / `staleKnowledgeHint` / `presentationTemplates.catalog` each
present exactly once per locale. S4 independently reached the same conclusion via
`git merge-tree` before the merge.

Commit order was 15 → i18n → permissions → composer/spinner → plan/toolcall/
thinking → copy+reasoning → scroll+citations → empty state → CodeBlock, with the
reasoning correction last. Read `68729a1c8` and `a6ef75fe2` first in review:
those are the two that depart from this doc.

**Three findings were wrong as written. All three were caught by measuring the
running app, and all three pass lint/tsc/jsdom either way** — see the discoveries
block below, which is the part worth carrying to other streams.

Owns: `renderer/pages/conversation/Messages/**`,
`renderer/pages/conversation/index.tsx`,
`renderer/pages/conversation/components/ChatConversation.tsx`,
`renderer/pages/conversation/platforms/**` (for emptySlot pass-through),
`renderer/components/chat/SendBox/index.tsx`,
`renderer/components/Markdown/CodeBlock.tsx`,
and — granted, see re-verification item 1 — `renderer/components/Markdown/ShadowView.tsx`.
MUST NOT touch: `pages/conversation/components/ChatLayout/**` (Stream 5 — sibling
of ChatConversation.tsx), anything in `components/chat/TemplateGallery/`
(Stream 1; `MessageText.tsx` imports `TemplateMessageCard` — consume, don't edit).

#### Reusable discoveries from implementing S3 (2026-07-31)

Four things that generalise. The first three cost real time; each was invisible
to lint, tsc and jsdom and only showed up under measurement.

1. ⚠️ **`.arco-btn` sets `border-color: transparent` and beats an unprefixed
   border utility.** Converting a styled `div` to an Arco `Button` and carrying
   the border classes across is not enough: measured `rgba(0,0,0,0)` on the
   scroll-to-bottom control with `b b-solid border-4`. Needs `!b !b-solid
   !border-4`. This is a *second* `.arco-btn` trap beyond the display/padding one
   this doc already warns about, and it applies to every finding in any stream
   that turns a bordered div into a Button.
2. ⚠️ **Inline `style` beats every utility class, and this codebase uses inline
   borders more than you'd expect.** Before "fixing" a border utility, check for
   an inline `borderColor` on the same element — see the finding-15 correction
   below. Generating the CSS proves what a class *emits*; it does not prove the
   class *wins*.
3. ⚠️ **`CollapsibleContent` cannot bound content that grows after mount** —
   see the new escalation at the bottom of this doc. Do not reach for it for
   streamed or progressively revealed content.
4. **Switching theme for a live check requires the app's own Appearance
   settings, not `data-theme`.** Several colours come from React state
   (`useInputFocusRing` reads `useThemeContext`), so stamping
   `data-theme='dark'` on `<html>` flips the CSS vars while leaving inline
   styles on the *old* theme — a hybrid state that reads as a bug that isn't
   there. It gave a wrong first reading here. Drive
   `#/settings/appearance` → click "WePrompt Light"/"WePrompt Dark" instead;
   `Emulation.setEmulatedMedia` alone is likewise insufficient.

Smaller, still useful:

- **jsdom + partial Arco mocks are a landing hazard.** Adding an Arco import to
  a component silently breaks every *other* suite that mocks
  `@arco-design/web-react` with an object literal — the failure is
  `No "X" export is defined on the mock`, far from your change. Adding `Button`
  and `Tooltip` cost four unrelated test files here. Grep
  `vi.mock('@arco-design/web-react'` for suites rendering your component before
  assuming your change is test-clean.
- **To exercise a zero-message conversation, query the dev DB** —
  `sqlite3 ~/.aionui-dev/aionui-backend.db "SELECT c.id, (SELECT COUNT(*) FROM
  messages m WHERE m.conversation_id=c.id) n FROM conversations c ORDER BY n"`.
  The UI never creates one (both "New Chat" and "New chat in this project" route
  to `#/guid`; the conversation is created on first send), so an empty state is
  otherwise unreachable by clicking.
- **The dev profile's message corpus is thin**: only `text`, `tool_call` and
  `tips` rows exist, so `MessagePlan`, `MessageThinking` and both permission
  cards cannot be seen live at all. Budget for unit tests as the only evidence
  on those.
- `--primary-6` is defined by Arco on `<body>`, **not** on `<html>`. Anything
  reading `getComputedStyle(document.documentElement)` for it gets `''` — which
  is why `ShadowView`'s cssVars map cannot forward it.

#### ⚠️ RE-VERIFICATION at `bf75fc373` (2026-07-31) — read before implementing

**UNBLOCKED.** The KB stale-chat hint has landed, in exactly the three files the
escalation predicted. Independently re-derived at the current tip: **14 of 15
findings are byte-exact**; only finding 13 moved, because it is the only one
citing a changed file. Both of the doc's most-likely-wrong claims survived
scrutiny (the shadow-DOM correction in finding 10, and all ~20 in-repo reference
patterns are at their stated lines). This is the most accurate of the three
sections. Five things to fix or add:

1. **⛔ OWNERSHIP — RESOLVED, ruling below.** Finding 10's prescribed fix needs
   `components/Markdown/ShadowView.tsx`, which **no stream owned**, so protocol
   rule 3 would have stopped the session. **Ruling: `ShadowView.tsx` is granted to
   Stream 3.** Nothing else claims it, and Stream 3 already owns `CodeBlock.tsx`,
   the only file rendering into that shadow root. (Same precedent as granting
   `useTeamList.ts` to Stream 2.) Two constraints on the fix: the doc's claim that
   `.markdown-local-file-copy` (`ShadowView.tsx:117-135`) is "exactly this pattern
   already solved" is **false** — there is no `:focus-visible` rule anywhere in
   that file, so there is no precedent to copy; and `ROW_FOCUS_RING` **cannot** be
   reused here, for two independent reasons: it is a UnoCSS class (never compiled
   into the shadow root) and `--primary-6` is not among the ten CSS vars
   `ShadowView` forwards (`:357-368`), so its colour would not resolve. Build the
   ring with a literal colour in `createInitStyle`. Acceptable contained
   alternative if that grows: React `onFocus`/`onBlur` state gated on
   `event.target.matches(':focus-visible')` driving an inline outline, entirely
   inside `CodeBlock.tsx`.
2. **NEW finding 16 — promoted from an aside to actionable. The stream is 16, not
   15.** `ToolOutputCitations.tsx:46-57` renders
   `<a className='kb-citation-link' role='button' tabIndex={0} onClick={...}>` with
   **no `onKeyDown`** — Enter does nothing. That is a live WCAG 2.1.1 failure on a
   feature that shipped ten days ago (KB citations, MR !17), the file sits squarely
   in this stream's `Messages/**`, and `activateOnEnterOrSpace` is a two-line
   drop-in that keeps the anchor, role, tabIndex and className intact.
   `MessageToolGroupSummary.css:121-129` also has no `:focus-visible`.
3. **Finding 13's line numbers MOVED** (the only such finding). `ChatConversation.tsx`:
   AionrsChat 226→**232**, LegacyReadOnlyConversation 295→**303**, AcpChat 300→**308**;
   `presetAssistantInfo` 173→**179**, panel signature 145-148→**151-154**, aionrs
   threading 344→**356**. `AcpChat` 37/53/86→**38/57/92**; `AionrsChat`
   35/50/83→**36/54/89**. Still valid: none of the three call sites passes
   `emptySlot`. **What the hint changed:** `<KbStaleChatHint/>` now sits *between*
   the message list and the composer — AionrsChat `:91-96` (unconditional, outside
   FlexFullContainer), AcpChat `:97-102` (inside the existing `!hideSendBox`
   guard, wrapped in a fragment with AcpSendBox). It self-sizes with
   `getChatSurfaceWidthClass(...)` — **the same helper finding 12 wants**, so that
   is the house pattern for anything added to the composer area. It fails closed
   and renders nothing unless the chat is project-scoped with a frozen MCP
   snapshot lacking the knowledge server, so it will not fight an empty state —
   but greeting + alert + composer stacked is the one combination to eyeball.
   Do NOT restructure AcpChat's `!hideSendBox` fragment (three test files cover
   the hint), and only `{body, action}` exist under `conversation.staleKnowledgeHint`
   — `changedBody` was removed by !22, so do not plan around a second variant.
4. **Finding 4's suggested React key reintroduces the bug it fixes.**
   `key={item.content || index}` duplicates when two plan entries share text. Use
   an index-qualified key. Also `messages.plan` does not exist as a parent object
   in **any** locale, so all 12 edits create a new block.
5. **The "existing keys you can reuse" list overstates.** `messages.reasoning` and
   the whole `messages.permission.*` block ship in **en-US only** — 11 locales
   render them in English today via `fallbackLng` (`i18n/index.ts:129`), and
   `check-i18n.js` treats missing translations as **warnings**, not errors. So the
   protocol's "all 12" rule is stricter than the repo it describes. Still do all
   12 for new keys; just know the baseline is inconsistent.

Minor: finding 5 cites the `group` class at `:317`; it is at `:318`. Finding 15 is
the best first commit — one token, no i18n, clean gate baseline. The `border-3`
sweep finding 15 asks for is already **provably complete**: a full grep of every
Stream 3 owned file returns exactly finding 15's line and finding 9's
`MessageList.tsx:834`, nothing else.

#### Dispatcher rulings — findings 12, 13 and i18n depth (ANSWERED 2026-07-31)

**Finding 12 → minimal centred Spin. Do NOT promote `MessageListSkeleton`.** Use
the house idiom verbatim from `TeamChatView.tsx:248`:
`<Spin loading className='flex flex-1 items-center justify-center' />`. A one-line
change at `pages/conversation/index.tsx:66`; this also makes the finding's
child-vs-instead-of sub-question moot, so it does not need answering.
Why, from the code rather than taste: (a) **`MessageListSkeleton` is already used
for the phase it was designed for** — `MessageList.tsx:786`, the message-loading
phase *inside* MessageList. The `isLoading` at `index.tsx:66` is an earlier and
different phase: fetching the conversation *record*. (b) That phase can resolve
into **not-found → toast → redirect home** (`index.tsx:60-66`), so a
message-shaped skeleton would fake a conversation that may not exist and then be
yanked — worse than a neutral spinner. (c) Promoting the skeleton as
ChatConversation's child would mean mounting `ChatConversation` with no
conversation, an invasive change to the file most exposed to rebase and the one
carrying `KnowledgeCitationsProvider`. (d) It would also require exporting a
module-local component and threading `rowWidthClass` for no user-visible gain.

**Finding 13 → a light, text-only greeting. No prompt chips, no draft-filling.**
Supply `emptySlot` from `ChatConversation` for the **interactive platforms only**
(`AcpChat`, `AionrsChat`) and **NOT** for `LegacyReadOnlyConversation` — inviting
someone to start typing in a read-only conversation is a bug, and the finding's
"three call sites" framing hides that. Content: one centred, muted line
(`text-t-secondary`, no card, no avatar, no SWR) sized with
`getChatSurfaceWidthClass(...)` so it aligns with the composer column — the same
helper the KB hint uses. **ONE new i18n key**, not a family.
Why not the team idiom: `TeamChatEmptyState` is heavy and team-specific by
construction — SWR for the conversation, preset-assistant info, agent logos,
teammate identity colour, and `fillDraft` wiring into both draft stores, with
`if (!team_id) return null`. Copying it means a parallel component of comparable
weight. And prompt chips would **compete with the template gallery** on GuidPage
that the user just came from (which Stream 1 has just reworked). **Guard: if this
starts growing an avatar, a fetch, or chips, stop and ship the one line** — that
growth is precisely how `TeamChatEmptyState` got to its current size.
**Do NOT suppress it when `KbStaleChatHint` is showing.** They occupy different
regions (the greeting is inside the message-list area; the hint sits between the
list and the composer), the hint fails closed and is rare, and coupling the two
would create a dependency between Stream 3's empty state and the KB hint's
internals for a purely cosmetic concern. Keeping the greeting visually quiet is
what resolves the stacking — the alert *should* dominate, because it is the only
actionable element of the two.

**i18n depth → all 12 locales for every NEW key this stream adds. Do NOT retrofit
the existing en-US-only blocks** (`messages.reasoning`, `messages.permission.*`)
— that inconsistency predates the stream, `check-i18n.js` treats it as a warning,
and fixing it is a separate ticket. Note it in one line in the MR instead. This
keeps the stream bounded and stops the implementer being bounced in review from
either direction.

#### Findings — verified against `d60397537`

**15 actionable, 0 void** — **now 16**, see re-verification item 2 above. Every `path:line` below was re-checked at this tip; trust these over any older list.

> **FINAL (S3 implemented, 2026-07-31): 15 done, 1 void.** Finding 15 turned out
> to be a false positive once measured in the running app; findings 6 and 9 were
> done differently from the prescription. Those three carry corrected statuses
> inline below — read them before trusting the surrounding prose, which is the
> pre-implementation text and has been left intact for provenance.

> Numbering is stable: it reflects the original verification order, so a number is never reused. Void items keep their number and are listed at the end — if the notes below reference `#N`, that is this numbering.

> **Stream notes:** SCOPE / VERIFICATION BASIS: read-only worktree at d60397537 ("Merge branch 'feat/kb-citation-clickthrough' into 'sprint1'"). Every finding still exists in some form — nothing was ALREADY_FIXED and no file is gone. Only line numbers moved. One sub-claim inside finding 10 is factually wrong at this tip (the md:opacity-0 hover-hiding); details are in that finding's `problem` field and repeated below because it changes what the fix should be. === KB CITATION CLICK-THROUGH: WHAT A STREAM 3 IMPLEMENTER MUST NOT BREAK === Three files cooperate. Breaking any one silently kills clickable citations (no error, links just go dead or leak to the OS browser). 1) packages/desktop/src/renderer/components/Markdown/index.tsx - :84-88 inside `handleLinkClick`: `if (isKbCitationHref(href)) { const citation = parseKbCitationHref(href); if (citation) onKbCitationClick?.(citation.fileName, citation.anchor); return; }`. This check MUST stay BEFORE the `openExternalUrl(href)` call at :89. If reordered or removed, a `weprompt-kb://` URL is handed to the OS browser. - :174-176 `urlTransform={(url) => isKbCitationHref(url) || resolveLocalFileLinkPath(url) ? url : defaultUrlTransform(url)}`. react-markdown's default transform strips unknown schemes, so removing the whitelist makes every citation href become empty and the anchor becomes inert. Both halves of that OR are load-bearing (the second one is local-file links). - :113-127 the `a` component override: local-file refs short-circuit to `<LocalFileLink>`; everything else gets `onClick={handleLinkClick}`. If you restructure `components`, keep `handleLinkClick` in the memo deps at :161 — the comment at :96-98 explains why component identity must be stable across streaming updates (new function refs remount every custom component and lose hook/DOM state). - `onKbCitationClick` is an optional prop (:48); it is only passed on the non-JSON markdown path. 2) packages/desktop/src/renderer/pages/conversation/Messages/components/MessageText.tsx - :265 `const citations = useKnowledgeCitationsSafe()` and :270-273 `linkifiedMarkdown` — the linkify runs on `markdownSource` (:269), i.e. the EXACT string MarkdownView receives AFTER progressive reveal. If you change the progressive-reveal plumbing (`useProgressiveText`, :63-123) or the `markdownSource` expression, keep linkify downstream of it and keep it memoized and pure; partially revealed filenames simply don't match yet, which is intended. - :409-415 passes BOTH `onLocalFileLink={handleLocalFileLink}` and `onKbCitationClick={citations?.openCitation}`. Only this branch gets the citation handler; the JSON branch at :401-404 deliberately does not. Do not "tidy" them into one call. - Any finding-5 or finding-6 edit is safely outside this path, but do not remove the `data-testid`s (`message-text-content`, `message-reasoning`) — tests use them. 3) packages/desktop/src/renderer/pages/conversation/components/ChatConversation.tsx - `KnowledgeCitationsProvider` is mounted in BOTH return paths: :343-346 (aionrs early return, wrapping AionrsConversationPanel) and :374-391 (everything else, wrapping ChatLayout). The finding-13 fix touches exactly these two returns — if you refactor them into one, the provider must still wrap both, and it must receive `conversation` (it no-ops and provides `null` unless `conversation.extra.project_id` exists; see KnowledgeCitationsContext.tsx:134). It also renders the preview drawer as a sibling of children at :136-151, so it must stay ABOVE ChatLayout, not inside MessageList. Also in scope and citation-related: Messages/components/ToolOutputCitations.tsx:46-57 renders citation headers in tool output as `<a className='kb-citation-link' role='button' tabIndex={0} onClick={...}>` — styled by MessageToolGroupSummary.css:121-129. It has role+tabIndex but NO onKeyDown, so Enter does nothing (an a11y gap of the same family as findings 5/8/9/10, not on your list). If you do a keyboard-accessibility sweep in Messages/components, adding onKeyDown there is cheap and consistent; do not remove the role/tabIndex/className. === SHADOW DOM: THE BIG GOTCHA FOR FINDING 10 === CodeBlock is rendered ONLY through MarkdownView (components/Markdown/index.tsx:106-112), which portals its children into a shadow root via ShadowView (index.tsx:168). ShadowView injects one hand-written stylesheet (ShadowView.tsx:16-276, plus a KaTeX adopted sheet at :380-383). Neither UnoCSS output nor Arco's stylesheet crosses that boundary. Consequences: - `className='group'` (CodeBlock.tsx:127) and `className='opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity'` (:144) match NOTHING. The copy/collapse controls are always visible today. The finding's "invisible until hover on desktop" claim does not reproduce. - Any class-based styling for shadow content must be added to `createInitStyle`. Precedents already there: `.markdown-local-file-link` (:77), `.markdown-local-file-copy` (:117 — a real focusable button styled from inside the shadow sheet), `.loading` (:258, used by MermaidBlock). - Arco `Message` is already defensively try/caught in CodeBlock (:103-114) with the comment "Shadow DOM portal may fail silently". - Therefore, in CodeBlock only, native `<button>` + inline styles (or a class added to createInitStyle) is the correct move despite AGENTS.md's "no raw interactive HTML in new UI" rule; say so in the commit message. Everywhere else in this stream, use Arco. - Same caveat applies in reverse: MessageText's copy button, MessageThinking, MessagePlan, MessageToolCall, MessageList and SendBox are all in normal renderer DOM, so their UnoCSS classes DO work and Arco components are the right choice. === SHARED CONVENTIONS THAT AFFECT SEVERAL FINDINGS === - Dark-mode border trap confirmed live: uno.config.ts:38 maps `border-3` → `var(--bg-3)`. MessageList.tsx:834 uses `border-1 border-solid border-3` on the scroll-to-bottom button — that ring is invisible in dark. Use `border-4`. One more `border-3` in this stream's files was MISSED by that sweep and is covered as finding 15 below: `components/chat/SendBox/index.tsx:1424` draws the composer's own outline with `border-3` on `bg-dialog-fill-0`. - Existing i18n keys you can reuse without touching locales: `common.copy`, `common.copySuccess`, `common.copyFailed`, `common.collapse`, `common.expand`, `common.expandMore`, `common.viewMoreLines`, `common.send`, `common.more`, `messages.scrollToBottom`, `messages.reasoning`, `tools.labels.arguments` ("Arguments:"), `tools.labels.result` ("Result:"). - New keys required (all 12 locales under packages/desktop/src/renderer/services/i18n/locales/<locale>/, then `bun run i18n:types` + `node scripts/check-i18n.js`): a permission-response-failed message (finding 1), a stop-generating label (finding 3), a plan title (finding 4), and the solo empty-state strings (finding 13). Locales present: de-DE, en-US, es-ES, fa-IR, ja-JP, ko-KR, pt-BR, ru-RU, tr-TR, uk-UA, zh-CN, zh-TW. - MessageToolGroupSummary.tsx is the single best in-repo model for this whole stream: accessible Arco toggle with useId'd aria-controls (:362-375, :540-553), semantic text tokens (:359, :365), i18n'd detail labels (:386, :392), iconColors-based @icon-park status icons (:428-452), and a correct hover-reveal-with-focus-escape button (:411-421). Prefer copying it over inventing. - Do NOT cite components/chat/CollapsibleContent.tsx:213 as a pattern — it uses a raw `<button>`, which violates the Arco-only rule; its gradient constants (:16-24) and its API are fine to reuse. - MessagePlan.tsx is the only file in Messages/components/ missing the Apache-2.0 license header; add it if you touch the file. === TEST LANDSCAPE === Relevant existing suites: tests/unit/renderer/messageThinking.dom.test.tsx (asserts on rendered summary text, so keep the label inside whatever element you convert the header to), tests/unit/renderer/messageList.dom.test.tsx (mocks useAutoScroll at :82, has a scroller-overflow stub helper ~:928, already renders MessageList with an emptySlot at :879, and asserts the loading skeleton via `data-testid='message-list-skeleton'` at :996), tests/unit/renderer/messageListStreaming.dom.test.tsx, tests/unit/renderer/markdownLocalFileLink.dom.test.tsx (mocks ShadowView at :14 and CodeBlock at :19 — mock the former but not the latter to test CodeBlock in plain jsdom; also shows the standard Arco/@icon-park/react-i18next mock set). There is NO existing test for MessagePermission, MessageAcpPermission, MessagePlan, MessageToolCall, CodeBlock or the SendBox send/stop buttons — those findings need new files. Preserve these test handles if you refactor: `message-permission-card`, `message-permission-option-*`, `message-acp-permission-card`, `message-acp-permission-option-*`, `sendbox-send-btn`, `sendbox-mobile-plus-btn`, `sendbox-input`, `sendbox-highlight-layer`, `message-list-scroller`, `message-list-content`, `message-list-reserve`, `message-list-skeleton`, `message-text-content`, `message-reasoning`, `skill-suggest-card`, and the `data-status-icon` / `data-status` attributes in MessageToolGroupSummary.

##### 1. Permission confirm failures are swallowed (console.error only, no Message.error)

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePermission.tsx:38`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePermission.tsx:52`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePermission.tsx:53`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePermission.tsx:54`
  - `packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx:52`
  - `packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx:66`
  - `packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx:67`
  - `packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx:68`
  - `packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx:70`
- **Problem:** Both permission cards catch the confirm-IPC rejection and only log. MessagePermission.tsx:52-56 is `} catch (error) { console.error('Error confirming permission:', error); } finally { setIsResponding(false); }` — `setHasResponded(true)` (line 51) is skipped, so the card silently returns to the un-answered state with no toast, no retry hint. MessageAcpPermission.tsx:66-71 is byte-for-byte the same shape (its catch even carries the stale comment `// Handle error case - could add error logging here`). Net effect: user clicks Allow, the invoke rejects (agent gone / call_id stale / IPC dropped), the card looks untouched and the agent stays blocked forever. Neither file imports `Message` from Arco today — MessagePermission.tsx:9 imports `{ Button, Card, Typography }`, MessageAcpPermission.tsx:9 the same.
- **Done when:** In both `handleConfirm` catch blocks, call `Message.error(t('<newkey>'))` before/instead of the bare console.error, adding `Message` to the existing `@arco-design/web-react` import in each file. Add ONE new key (e.g. `messages.permissionResponseFailed`: "Couldn't send your response. Please try again.") to all 12 locale files at packages/desktop/src/renderer/services/i18n/locales/<locale>/messages.json — no such key exists today (nearest siblings are `messages.responseSentSuccessfully`, `messages.permissionRequest`). Note MessageAcpPermission.tsx already has `t` in scope (line 21); MessagePermission.tsx already has it (line 28). Then run `bun run i18n:types` and `node scripts/check-i18n.js`. Done when a rejecting confirm IPC produces a visible red toast and the option buttons become clickable again.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/conversation/Messages/components/SkillSuggestCard.tsx:58 — same directory, `catch (err) { Message.error(t('cron.skill.saveFailed')); console.error(...) } finally { setSaving(false) }`
- **Testing:** New tests/unit/renderer/*.dom.test.tsx: render MessagePermission with a mocked `ipcBridge.conversation.confirmation.confirm.invoke` that rejects, click the option button, assert the Arco `Message.error` spy was called. Follow the existing mocking style of tests/unit/renderer/markdownLocalFileLink.dom.test.tsx:41 (it vi.mocks `@arco-design/web-react` wholesale) and :62 (react-i18next `t` returns defaultValue/key).

##### 2. Permission option buttons have no in-flight loading state

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePermission.tsx:89`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePermission.tsx:93`
  - `packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx:101`
  - `packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx:105`
- **Problem:** MessagePermission.tsx:89-98 renders each option as `<Button ... disabled={isResponding} onClick={() => void handleConfirm(value)} />` and MessageAcpPermission.tsx:101-110 does the same with `disabled={isResponding}` at :105. `disabled` alone gives no signal about WHICH option was pressed or that anything is in flight — during a slow confirm the whole row just greys out. Arco's `loading` prop is used elsewhere in this exact directory and is not used here.
- **Done when:** Replace the single `isResponding` boolean with a pending-value state, e.g. `const [pendingValue, setPendingValue] = useState<string | null>(null)` set at the top of `handleConfirm` and cleared in `finally`. On each Button keep `disabled={pendingValue !== null && pendingValue !== value}` and add `loading={pendingValue === value}` so the pressed button shows Arco's spinner while its siblings stay disabled. Apply the identical change in MessageAcpPermission.tsx using `option_id` as the key. No new i18n keys needed. Preserve the existing `data-testid={`message-permission-option-${value}`}` / `message-acp-permission-option-${option_id}` attributes — they are the only handles tests have.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/conversation/Messages/components/SkillSuggestCard.tsx:94 — `<Button type='primary' size='small' loading={saving} onClick={handleSave}>`
- **Testing:** Same DOM test as finding 1: resolve the confirm invoke from a deferred promise, assert the clicked button carries Arco's loading class / `.arco-btn-loading` before resolution. jsdom renders Arco Buttons fine; no shadow DOM involved.

##### 3. Send and Stop composer buttons are icon-only with no accessible name

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/components/chat/SendBox/index.tsx:1313`
  - `packages/desktop/src/renderer/components/chat/SendBox/index.tsx:1327`
- **Problem:** `sendButton` (SendBox/index.tsx:1313-1325) is `<Button shape='circle' type='primary' ... icon={<ArrowUp .../>} data-testid='sendbox-send-btn' />` — no `aria-label`, no `title`, no wrapping `Tooltip`. `stopButton` (:1327-1335) is worse: `<Button shape='circle' type='secondary' className='bg-animate sendbox-stop-button' icon={<div className='mx-auto size-12px bg-6'></div>} onClick={stopHandler} />` — an unlabelled div as its glyph, no aria-label, and no data-testid either. Both are the primary action of the whole composer. The omission is internally inconsistent: `mobilePlusButton` in the same file (:1356-1366) does carry `aria-label={t('common.more', { defaultValue: 'More' })}` at :1364.
- **Done when:** Wrap each in `<Tooltip content={label} mini>` and set `aria-label={label}` on the Button (both, matching SpeechInputButton). Send uses the existing key `common.send` ("Send"). Stop needs a NEW key — no suitable one exists (only `conversation.chat.speech.stopTooltip`="Stop recording" and `conversation.chat.speech.stopShort`); add e.g. `conversation.chat.stopGenerating`: "Stop generating" to all 12 packages/desktop/src/renderer/services/i18n/locales/<locale>/conversation.json. Also add `data-testid='sendbox-stop-btn'` to the stop Button for symmetry with `sendbox-send-btn`. Do not change `shape='circle'`, `className='send-button-custom'`, `className='bg-animate sendbox-stop-button'`, or the disabled logic at :1310 — CSS and existing tests key off those. Run `bun run i18n:types` + `node scripts/check-i18n.js`.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/components/chat/SpeechInputButton.tsx:231 — `<Tooltip content={ariaLabel} mini><Button ... aria-label={ariaLabel} icon={icon} /></Tooltip>`, i.e. tooltip content and aria-label share one i18n string
- **Testing:** jsdom + @testing-library: `screen.getByLabelText('Send')` / `getByRole('button', { name: 'Stop generating' })`. Arco Tooltip needs no portal for the aria-label to land, so no special setup.

##### 4. MessagePlan: missing React key, hardcoded English string, hardcoded hex colors, non-keyboard toggle

- **Status:** `HOLDS` — holds exactly as originally found
- **Effort:** medium
- **Where:**
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePlan.tsx:1`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePlan.tsx:10`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePlan.tsx:11`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePlan.tsx:16`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePlan.tsx:18`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePlan.tsx:20`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePlan.tsx:23`
- **Problem:** All four defects are still present at the original lines (the whole file is 36 lines). (a) :16-29 `message.content.entries.map((item, index) => ... <div className='flex flex-row items-center color-#86909C gap-8px'>` — the returned div at :18 has NO `key`, and `index` is captured but unused. (b) :11 `<Badge status='default' text='To do list' ...>` — hardcoded English; the file has no `react-i18next` import at all (imports are only Arco Badge, Arco icons, React, and the IMessagePlan type at :1-4). (c) hardcoded colors at :10 `color-#86909C`, :11 `color-#86909C` inside the Badge className override, :18 `color-#86909C`, :20 `color-#00B42A`, :23 `b-[rgba(201,205,212,1)]`. (d) :10 the expand/collapse row is `<div className='... cursor-pointer' onClick={() => setShowMore(!showMore)}>` with no role, tabIndex, onKeyDown or aria-expanded. The file also lacks the Apache-2.0 license header every sibling in the directory carries.
- **Done when:** 1) Add `key={item.content || index}` (or a stable id) to the div at :18. 2) Add `const { t } = useTranslation()` and replace `text='To do list'` with `text={t('messages.plan.title')}`; add `messages.plan.title` to all 12 locales' messages.json, then `bun run i18n:types` + `node scripts/check-i18n.js`. 3) Swap `color-#86909C` → `text-t-secondary`, `color-#00B42A` → `text-success` (or `iconColors.success` from @/renderer/styles/colors, matching MessageToolGroupSummary.tsx:438), and `b-[rgba(201,205,212,1)]` → `border-4` (NOT border-3: in dark --bg-3 equals --dialog-fill-0 so the ring would vanish). Delete the `![&_span.arco-badge-status-text]:color-#86909C` override once the wrapper uses a token. 4) Convert the :10 toggle to an Arco `<Button type='text' size='mini' aria-expanded={showMore} aria-controls={panelId}>` (useId for panelId) and put `id={panelId}` on the :15 body div. Done when the file contains no `#` hex literals, no `rgba(`, no English literal, every mapped child has a key, and the toggle is reachable and operable by Tab+Enter.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx:362 (Arco text Button with aria-label/aria-expanded/aria-controls + useId at :274) and :455 (`text-t-secondary` row) and :438 (`iconColors.success`)
- **Testing:** jsdom DOM test rendering MessagePlan with two entries (one `completed`, one `pending`): assert no React key warning on console.error, assert `getByRole('button', { expanded: true })`, and assert the i18n'd title. React logs the missing-key warning via console.error — spy on it to prove the regression is gone.

##### 5. Message copy button is unreachable by keyboard (opacity-0 + pointer-events-none, dead focus-within fallback)

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageText.tsx:294`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageText.tsx:296`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageText.tsx:297`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageText.tsx:423`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageText.tsx:431`
- **Problem:** MessageText.tsx:294-304 defines `copyButton` as a plain `<div onClick={handleCopy}>` (no role, no tabIndex) whose className at :297 is `'p-4px rd-4px cursor-pointer hover:bg-3 transition-colors opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto'`. The `focus-within:` pair can never fire: the div has no focusable descendant (the child is an @icon-park `Copy` svg) and the div itself is not focusable. The `group` class it depends on is on the wrapper at :317. So a keyboard-only user can never copy a reply. The row is also dropped entirely on mobile (`!isMobile && showCopyRow` at :423), and the timestamp beside it (:431) is `opacity-0 group-hover:opacity-100` too, which is fine as decoration.
- **Done when:** Replace the div at :296-300 with an Arco `<Button type='text' size='mini' shape='circle' aria-label={t('common.copy', { defaultValue: 'Copy' })} onClick={handleCopy} icon={<Copy theme='outline' size='16' fill={iconColors.secondary} />} />`, keeping the existing `<Tooltip content={t('common.copy', ...)}>` wrapper at :295. Change the visibility classes to `opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity` and DROP `pointer-events-none` / `group-hover:pointer-events-auto` / both `focus-within:` variants — with a real focusable Button, `focus-visible:opacity-100` works and pointer-events must stay enabled so a focused button can be activated. `common.copy` already exists in all locales, so no i18n work. Done when Tab reaches the copy control on an AI reply, it becomes visible on focus, and Enter/Space copies.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx:411 — `<Tooltip content={t('acp.image.download')}><Button aria-label={t('acp.image.download_aria')} className='... opacity-0 ... group-hover:opacity-90 focus:opacity-100' shape='circle' icon={<Download .../>} /></Tooltip>`: exact same hover-reveal pattern done correctly, including the focus escape hatch
- **Testing:** jsdom DOM test: render MessageText with a left-position text message and `showCopyRow`, mock `useLayoutContext` to isMobile:false, then `await user.tab()` until `getByRole('button', { name: 'Copy' })` has focus and assert the clipboard util (mock `@/renderer/utils/ui/clipboard`) was called on Enter.

##### 6. Inline reasoning block renders always-expanded with no collapse and no max-height

- **Status:** ✅ **DONE (`57d2e231e`, corrected by `a6ef75fe2`) — the "cheapest coherent option" below is a TRAP; take the "preferred option".**
  Wrapping the body in `CollapsibleContent maxHeight={160} defaultCollapsed useMask` **ships a
  regression**: it left the reasoning clipped at 160px behind a fade with **no expand control at
  all**, i.e. strictly worse than the unbounded state, since the content became unreadable
  rather than merely long. Measured in the running app: `max-height: 160px` on a body with
  `scrollHeight: 291`, and the `.relative` wrapper had exactly one child — no toggle. Cause:
  `CollapsibleContent` gates its toggle on `needsCollapse`, computed by a ResizeObserver
  watching the element whose own box is already pinned to `maxHeight`, so it never observes the
  growth (see the new escalation at the bottom of this doc). It works for the JSON branch only
  because that content is present at mount.
  Shipped instead: the finding's own **preferred option** — `reasoningExpanded` state, the
  header row becomes an Arco text toggle with `aria-expanded`/`aria-controls`, body clamped to
  160px with a fade only while collapsed. Mirrors `MessageThinking`, no new i18n keys, and stays
  inside `MessageText.tsx` — `CollapsibleContent` is not this stream's file to fix. Verified
  live: collapsed 160px on a 291px body, click flips `aria-expanded` and renders the full 291px
  with the mask removed.
  ~~**Old status:** `MOVED` — still true; the line numbers below are the re-verified ones~~
- **Effort:** medium
- **Where:**
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageText.tsx:357`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageText.tsx:363`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageText.tsx:365`
- **Problem:** MessageText.tsx:357-370 renders the reasoning split out of `<think>` tags as `{!isUserMessage && !json && reasoning.trim() && (<div className='w-full mb-8px' data-testid='message-reasoning'>...)}` with a header at :359-362 and a body at :363-368 whose only constraints are `pl-12px text-13px text-t-secondary whitespace-pre-wrap` plus an inline `borderLeft: '2px solid var(--color-border-2)'`. No collapsed state, no `maxHeight`, no toggle — a long chain-of-thought pushes the actual answer arbitrarily far down. The sibling surface for the same content class, MessageThinking.tsx, DOES collapse: `const [expanded, setExpanded] = useState(!isDone)` at :41 plus the auto-collapse effect at :50-54. So the two reasoning surfaces behave inconsistently for the same user.
- **Done when:** Give the :363 body a bounded, collapsible presentation. Cheapest coherent option: wrap the body in the existing `<CollapsibleContent maxHeight={160} defaultCollapsed={true} useMask>` (already imported at MessageText.tsx:20 and used for JSON at :399) so long reasoning fades and gets an 'Expand More'/'Collapse' control for free with existing `common.expandMore`/`common.collapse` keys. Preferred option if a header toggle is wanted: mirror MessageThinking — add `const [reasoningExpanded, setReasoningExpanded] = useState(false)`, turn the :359 header row into an Arco `<Button type='text' size='mini' aria-expanded={reasoningExpanded} aria-controls={id}>` keeping the `Brain` icon and `t('messages.reasoning')` label, and render the body only when expanded (or clamp it with `maxHeight: 160, overflow: 'hidden'` when not). Keep `data-testid='message-reasoning'` on the outer div — do not rename it. No new i18n keys needed (`messages.reasoning`, `common.expandMore`, `common.collapse` all exist).
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/conversation/Messages/components/MessageThinking.tsx:41 and :89 (collapsed body via `styles.collapsed`); packages/desktop/src/renderer/components/chat/CollapsibleContent.tsx:79 (drop-in bounded/fade/toggle wrapper, already used at MessageText.tsx:399)
- **Testing:** jsdom: render MessageText whose content has `<think>`…`</think>` plus an answer; assert `getByTestId('message-reasoning')` exists and that the long reasoning text is NOT fully visible by default (check the computed maxHeight or absence of the tail text), then assert it appears after clicking the toggle. Note CollapsibleContent relies on ResizeObserver — jsdom needs a stub for it (it falls back to setTimeout only when ResizeObserver is undefined, so either provide a stub or delete the global in the test).

##### 7. MessageToolCall uses hardcoded greys and un-i18n'd Input/Output labels

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolCall.tsx:7`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolCall.tsx:77`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolCall.tsx:82`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolCall.tsx:86`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolCall.tsx:94`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolCall.tsx:95`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolCall.tsx:106`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolCall.tsx:112`
- **Problem:** Still exactly as described, shifted by a few lines. :77 `<div className='flex flex-row color-#86909C gap-12px items-center'>`; :86 `' cursor-pointer hover:color-#4E5969'`; :95 `className='flex-shrink-0 cursor-pointer hover:color-#4E5969 transition-colors'`. Labels: :106 `<div className='tool-detail-label'>Input</div>` and :112 `<div className='tool-detail-label'>Output</div>` — literal English. The file imports no `react-i18next` at all (imports run :7-18), so `t` must be introduced. Bonus a11y gap in the same block: the expand affordances at :82-92 (`<span onClick={...}>`) and :94-99 (`<span onClick={...}>`) are click-only spans with no role/tabIndex/aria-expanded, unlike the sibling that was already fixed.
- **Done when:** Add `const { t } = useTranslation()` (import from 'react-i18next'), replace `Input` → `{t('tools.labels.arguments')}` and `Output` → `{t('tools.labels.result')}` — both keys already exist in every locale (en-US/tools.json: "Arguments:" / "Result:", so drop any manual colon). Replace `color-#86909C` at :77 with `text-t-secondary`, and both `hover:color-#4E5969` occurrences (:86, :95) with `hover:text-t-primary`. While there, collapse the two duplicated click spans into one Arco `<Button type='text' size='mini' aria-expanded={expanded} aria-controls={detailPanelId}>` exactly as the sibling does, and put `id={detailPanelId}` (from `useId()`) on the panel div at :103. Done when the file has zero `#` hex literals and zero English literals, and the toggle is Tab-reachable with aria-expanded.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx:359 (`text-t-secondary` row), :365 (`hover:!text-t-primary`), :362-375 (accessible toggle Button with useId'd aria-controls), :386 (`t('tools.labels.arguments')`), :392 (`t('tools.labels.result')`) — same directory, same visual design
- **Testing:** jsdom: render MessageToolCall with a normalizable tool message that has input and output, expand it, and assert the labels come from the mocked `t` (the standard react-i18next mock in tests/unit/renderer returns the key, so assert on `tools.labels.arguments`). `.tool-detail-label` colour already comes from `var(--color-text-3)` in MessageToolGroupSummary.css:88-93, so no CSS change is needed there.

##### 8. MessageThinking header is a click-only div; its body text colour is a hardcoded hex in both themes

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageThinking.tsx:82`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageThinking.tsx:85`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageThinking.tsx:89`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageThinking.module.css:48`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageThinking.module.css:61`
- **Problem:** MessageThinking.tsx:82 is `<div className={styles.header} onClick={() => setExpanded((v) => !v)}>` — no role, no tabIndex, no onKeyDown, no aria-expanded, and no aria-controls pointing at the body div at :89. The arrow span at :85 conveys state visually only. Separately, MessageThinking.module.css:48 sets `color: #86909c` on `.body`, and the dark override at :61-63 (`:global([data-theme='dark']) .body`) only swaps `background: var(--aou-1)` — so the reasoning text stays the same mid-grey in light and dark. (The header/arrow already use `var(--aou-*)` tokens at :11, :18, :28, :39, so `.body` is the lone hex holdout in the file.)
- **Done when:** TSX: replace the :82 div with an Arco `<Button type='text' size='mini' className={styles.header} aria-expanded={expanded} aria-controls={bodyId} onClick={() => setExpanded(v => !v)}>` where `const bodyId = useId()` and `id={bodyId}` is added to the body div at :89 (keep `ref={bodyRef}` — the streaming auto-scroll effect at :70-74 depends on it, and keep `styles.collapsed`, which is `display:none`). CSS: change `.body { color: #86909c }` at :48 to `color: var(--text-secondary)` (the token the rest of the renderer uses for secondary body copy) and leave the dark background override alone. If `.header` needs to survive being an Arco Button, add `all: unset`-style resets inside the existing `.header` rule rather than fighting `.arco-btn` globally — note `.arco-btn` sets its own display, so keep `display: inline-flex` in the rule. Done when Tab focuses the summary row, Enter/Space toggles it, aria-expanded flips, and the body text is visibly lighter in dark theme.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx:540-553 — `<Button type='text' size='mini' className='tool-group-summary__header' aria-expanded={showDetails} onClick={...}>` with a CSS-module-ish class doing the styling; its arrow rotation classes live in MessageToolGroupSummary.css
- **Testing:** tests/unit/renderer/messageThinking.dom.test.tsx already exists and queries by rendered summary text (`screen.getByText('Thinking... · 5s')`) — that keeps working if the label text stays inside the button. Add assertions for `getByRole('button', { expanded: false })` after status flips to 'done'. That test mocks react-i18next to return `defaultValue`, so keep the `defaultValue` args at :77-78.

##### 9. MessageList: empty 'Gradient mask' div renders nothing; scroll-to-bottom is a div onClick with an invisible-in-dark border

- **Status:** ✅ **DONE (`bc1c6663c`) — but the prescribed border fix was insufficient; read this before copying it.**
  `border-4` alone is **not** enough once the div becomes an Arco `Button`: `.arco-btn` sets its
  own `border-color: transparent`, which beats an unprefixed utility at equal specificity, and
  the ring measured `rgba(0,0,0,0)` in the running app. The shipped class list is
  `!b !b-solid !border-4` — important on all three. Re-measured after the fix: `#d8cbb6` in
  light, `#2a3344` in dark, both visible against their surfaces. The dead 100px gradient div was
  deleted rather than given a real gradient. (Sub-claim (c) as originally written also
  understated the defect — see the compiled-CSS block: `border-1` + `border-3` emit two
  competing colours and no width at all, so the ring was absent in *both* themes, not just dark.)
  ~~**Old status:** `MOVED` — still true; the line numbers below are the re-verified ones~~
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/conversation/Messages/MessageList.tsx:829`
  - `packages/desktop/src/renderer/pages/conversation/Messages/MessageList.tsx:830`
  - `packages/desktop/src/renderer/pages/conversation/Messages/MessageList.tsx:832`
  - `packages/desktop/src/renderer/pages/conversation/Messages/MessageList.tsx:833`
  - `packages/desktop/src/renderer/pages/conversation/Messages/MessageList.tsx:834`
  - `packages/desktop/src/renderer/pages/conversation/Messages/MessageList.tsx:836`
- **Problem:** (a) :829-830 — `{/* Gradient mask */}` followed by `<div className='absolute bottom-0 left-0 right-0 h-100px pointer-events-none' />`. No background, no gradient, no mask: it paints nothing and only exists to occupy 100px of non-interactive absolute space above the scroll button. (b) :832-841 — the control itself is `<div className='flex items-center justify-center w-40px h-40px rd-full bg-base shadow-lg cursor-pointer hover:bg-1 transition-all hover:scale-110 border-1 border-solid border-3' onClick={handleScrollButtonClick} title={t('messages.scrollToBottom')} style={{ lineHeight: 0 }}>`: a div, so no keyboard access and `title` is not an accessible name for a non-interactive element. (c) That same class list hits the known dark-mode trap — `border-3` resolves to `--bg-3`, which in dark equals `--dialog-fill-0` (#1e2536), so the button's ring is invisible in dark theme.
- **Done when:** (a) Delete the dead div at :829-830 outright unless a fade is actually wanted; if a fade IS wanted, give it a real `background: linear-gradient(...)` driven by theme the way CollapsibleContent does (BG_GRADIENT_LIGHT/BG_GRADIENT_DARK) — do not leave a class-less empty box. (b) Replace the :833 div with an Arco `<Button shape='circle' aria-label={t('messages.scrollToBottom')} onClick={handleScrollButtonClick} icon={<Down theme='filled' size='20' fill={iconColors.secondary} />} />` wrapped in `<Tooltip content={t('messages.scrollToBottom')} mini>`; keep the `absolute bottom-20px left-50% -translate-x-50% z-100` positioner div at :832 as-is. `messages.scrollToBottom` already exists in all 12 locales — no i18n work. (c) Change `border-3` → `border-4` in the surviving class list (or drop the border and rely on `shadow-lg`). Done when the control is Tab-reachable with an accessible name, its ring is visible in dark theme, and no zero-effect div remains.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/components/chat/SpeechInputButton.tsx:231 (Tooltip+aria-label circular Arco Button); packages/desktop/src/renderer/components/chat/CollapsibleContent.tsx:21-24 and :200-208 (a real theme-aware gradient mask, if the mask is kept)
- **Testing:** tests/unit/renderer/messageList.dom.test.tsx already stubs scroller overflow (see the `stubScrollerOverflow` helper around :928) and mocks useAutoScroll's `scrollToBottom` at :82 — extend it to force `showScrollButton` true, then assert `getByRole('button', { name: 'Scroll to bottom' })` and that clicking it calls the mock. That file's react-i18next mock returns keys, so assert accordingly.

##### 10. CodeBlock controls: title= instead of aria-label, non-focusable spans, onClick footer div, literal 'text' language label

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** medium
- **Where:**
  - `packages/desktop/src/renderer/components/Markdown/CodeBlock.tsx:63`
  - `packages/desktop/src/renderer/components/Markdown/CodeBlock.tsx:127`
  - `packages/desktop/src/renderer/components/Markdown/CodeBlock.tsx:139`
  - `packages/desktop/src/renderer/components/Markdown/CodeBlock.tsx:144`
  - `packages/desktop/src/renderer/components/Markdown/CodeBlock.tsx:148`
  - `packages/desktop/src/renderer/components/Markdown/CodeBlock.tsx:155`
  - `packages/desktop/src/renderer/components/Markdown/CodeBlock.tsx:163`
  - `packages/desktop/src/renderer/components/Markdown/CodeBlock.tsx:168`
  - `packages/desktop/src/renderer/components/Markdown/CodeBlock.tsx:174`
  - `packages/desktop/src/renderer/components/Markdown/CodeBlock.tsx:224`
  - `packages/desktop/src/renderer/components/Markdown/CodeBlock.tsx:235`
- **Problem:** Three of the four sub-claims hold verbatim; ONE IS WRONG and the implementer must not chase it. Holds: (a) the collapse control is `<span title={expanded ? t('common.collapse') : t('common.expand')}>` at :148 with the click handler on the icon itself (:155 / :163) and the copy control is `<span title={t('common.copy')}>` at :168 with onClick on the `Copy` icon at :174 — spans, so not focusable, and `title` is not an accessible name; (b) the 'view more' footer at :224-246 is a bare `<div style={{cursor:'pointer'}} onClick={toggleExpanded}>` (onClick at :235) with no role/tabIndex/aria-expanded; (c) unlabelled fences fall back to the literal string `'text'` at :63 (`const language = match?.[1] || 'text'`) which is then rendered as the visible language chip at :139-141 — an un-i18n'd, meaningless label. WRONG SUB-CLAIM: 'md:opacity-0 until group-hover, so on desktop copy is invisible until hover'. CodeBlock only ever renders inside MarkdownView's Shadow DOM (components/Markdown/index.tsx:168 `<ShadowView>`), and ShadowView injects a hand-written stylesheet (ShadowView.tsx:16-276) plus only the KaTeX adopted sheet — no UnoCSS output crosses the shadow boundary. So `className='group'` at :127 and `className='opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity'` at :144 are DEAD classes: the controls are always visible. That is its own (smaller) defect: misleading dead code.
- **Done when:** Because this subtree lives in a shadow root, Arco components get no stylesheet there and Arco's portal-based Message is already defensively try/caught (:103-114) — so use native focusable elements with inline styles here and treat it as the documented exception to the 'no raw interactive HTML' rule, or add the needed rules to ShadowView's createInitStyle. Concretely: (1) turn the two spans at :148 and :168 into `<button type='button' aria-label={...} onClick={...}>` carrying the icon as a child, with inline `background:'transparent', border:0, padding:0, display:'flex', cursor:'pointer'` and a visible `:focus-visible` outline added to createInitStyle (mirror the existing `.markdown-local-file-copy` rule at ShadowView.tsx:117-135, which is exactly this pattern already solved); (2) turn the footer at :224-246 into a `<button type='button' aria-expanded={expanded} aria-controls={codeId}>` with the same inline styling, and put `id={codeId}` on the code wrapper at :181; (3) either delete the dead `group` / `md:opacity-*` classes at :127 and :144, or move the hover-reveal into createInitStyle as a real rule — do not leave dead utility classes; (4) when `match` is null, render nothing for the language chip (`{match?.[1] ? language.toLocaleLowerCase() : null}`) instead of 'text', and keep `language` defaulting to 'text' only for SyntaxHighlighter's `language` prop at :190. Reuse existing keys `common.copy`, `common.collapse`, `common.expand`, `common.viewMoreLines` — no new i18n needed. Done when Tab inside a rendered code block reaches copy and collapse, both announce a name, the footer toggles via keyboard, and an unlabelled fence shows no chip.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/components/Markdown/ShadowView.tsx:117 `.markdown-local-file-copy` + packages/desktop/src/renderer/components/Markdown/LocalFileLink.tsx — the in-repo precedent for a real focusable control inside this shadow root, styled by a class defined in createInitStyle
- **Testing:** tests/unit/renderer/markdownLocalFileLink.dom.test.tsx:14 vi.mocks `@/renderer/components/Markdown/ShadowView` away (and :19 mocks CodeBlock) — copy the ShadowView mock but NOT the CodeBlock mock so CodeBlock renders into normal jsdom, then use getByRole('button', { name: 'common.copy' }). Do not assert on hover/opacity in jsdom; UnoCSS classes are never compiled in tests.

##### 11. Permission cards are the only chat surface using emoji glyphs instead of @icon-park/react

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** medium
- **Where:**
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePermission.tsx:20`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePermission.tsx:35`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePermission.tsx:63`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePermission.tsx:113`
  - `packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx:29`
  - `packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx:36`
  - `packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx:45`
  - `packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx:88`
  - `packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx:126`
- **Problem:** MessagePermission.tsx:20-25 declares `const actionIcons: Record<string, string> = { exec: '⚡', edit: '✏️', info: '📖', mcp: '🔌' }`; :35 picks `summary.destructive ? '⚠️' : actionIcons[action] || '🔐'`; :63 renders it as `<span className='text-2xl'>{icon}</span>`; :113 hardcodes `✓ {t('messages.responseSentSuccessfully')}`. MessageAcpPermission.tsx mirrors this: `'🔐'` at :29, `kindIcons = { edit: '✏️', read: '📖', fetch: '🌐', execute: '⚡' }` at :36-41, `'⚡'` fallback at :45, `<span className='text-2xl'>{icon}</span>` at :88, and `✓` at :126. Neither file imports `@icon-park/react`. Every other chat surface uses it (MessageThinking.tsx:9 Brain/Right, MessageToolGroupSummary.tsx:4 Attention/CheckOne/LoadingOne/Right, MessageText.tsx:15 Copy/Brain). Emoji also don't respect `iconColors`, don't scale with icon size props, and render inconsistently across the 12 supported locales' platforms.
- **Done when:** Replace both emoji maps with `@icon-park/react` components keyed the same way and coloured via `iconColors` from '@/renderer/styles/colors': e.g. exec/execute → `Lightning`, edit → `Edit` (or `Write`), info/read → `Bookmark`/`FileDisplayOne`, mcp → `Api`/`Connect`, fetch → `Earth`, destructive → `Attention` with `fill={iconColors.danger}` (see the danger-colour finding below), generic → `Lock`. Render at `size='18'` inside the existing `<span className='flex-shrink-0'>` in place of `text-2xl`. Replace the `✓` literals (MessagePermission.tsx:113, MessageAcpPermission.tsx:126) with `<CheckOne theme='filled' size='14' fill={iconColors.success} />`. Type both maps as `Record<string, React.ReactNode>` (they are `Record<string, string>` today). Done when neither file contains an emoji codepoint and both import from '@icon-park/react'.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx:428-452 — the StepRow status-icon switch: `LoadingOne`/`CheckOne`/`Attention` at size 14 with `fill={iconColors.primary|success|warning}`, plus `data-status-icon` hooks for tests
- **Testing:** jsdom: the shared @icon-park mock style used in tests/unit/renderer/markdownLocalFileLink.dom.test.tsx:58 renders stub elements, so assert on a `data-testid`/`data-status-icon` you add to the icon rather than on glyph text. Existing `data-testid='message-permission-card'` / `message-acp-permission-card` must be preserved.

##### 12. Conversation loading state is a bare unwrapped Spin (renders top-left, not centered)

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/conversation/index.tsx:66`
- **Problem:** pages/conversation/index.tsx:66 is `if (isLoading) return <Spin loading></Spin>;` — no wrapper, no flex centering, no size. It paints a small spinner in the top-left of the content area while the SWR fetch for the conversation record resolves, which reads as a broken layout rather than a load. A far more polished skeleton already exists in this stream: `MessageListSkeleton` at packages/desktop/src/renderer/pages/conversation/Messages/MessageList.tsx:127-~180 (9 alternating bubble rows with shimmer lines, `data-testid='message-list-skeleton'`), used at MessageList.tsx:786 — but it is a module-local const and is NOT exported, and it requires a `rowWidthClass`.
- **Done when:** Minimum viable: `if (isLoading) return <Spin loading className='flex flex-1 items-center justify-center h-full' />;`. Better: export MessageListSkeleton from MessageList.tsx (`export const MessageListSkeleton`) and render `<MessageListSkeleton rowWidthClass={getChatSurfaceWidthClass(false)} />` from index.tsx, importing `getChatSurfaceWidthClass` from '@/renderer/pages/conversation/utils/chatSurfaceWidth' (it returns STANDALONE_CHAT_SURFACE_WIDTH_CLASS = 'chat-surface-fluid' for non-team). Note the skeleton has no chat chrome (no header/sider), so if the goal is 'no layout jump', the skeleton should be rendered as ChatConversation's child rather than instead of ChatConversation — decide explicitly and state which. Done when the loading state fills the conversation pane instead of hugging the top-left corner.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/team/components/TeamChatView.tsx:248 — `<Suspense fallback={<Spin loading className='flex flex-1 items-center justify-center' />}>`, the in-repo centered-Spin idiom; packages/desktop/src/renderer/pages/conversation/Messages/MessageList.tsx:127 for the richer skeleton
- **Testing:** tests/unit/renderer/messageList.dom.test.tsx:996 already covers 'renders a skeleton while the initial message batch is loading' via `data-testid='message-list-skeleton'` — reuse that testid if you promote the skeleton. For index.tsx itself, mock useSWR to return `{ isLoading: true }` and assert the spinner's container has the centering classes.

##### 13. emptySlot is plumbed through every platform chat but ChatConversation never supplies one

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** medium
- **Where:**
  - `packages/desktop/src/renderer/pages/conversation/components/ChatConversation.tsx:226`
  - `packages/desktop/src/renderer/pages/conversation/components/ChatConversation.tsx:295`
  - `packages/desktop/src/renderer/pages/conversation/components/ChatConversation.tsx:300`
  - `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsChat.tsx:35`
  - `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsChat.tsx:50`
  - `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsChat.tsx:83`
  - `packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpChat.tsx:37`
  - `packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpChat.tsx:53`
  - `packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpChat.tsx:86`
  - `packages/desktop/src/renderer/pages/conversation/platforms/legacy/LegacyReadOnlyConversation.tsx:23`
  - `packages/desktop/src/renderer/pages/conversation/platforms/legacy/LegacyReadOnlyConversation.tsx:24`
  - `packages/desktop/src/renderer/pages/conversation/platforms/legacy/LegacyReadOnlyConversation.tsx:41`
  - `packages/desktop/src/renderer/pages/conversation/Messages/MessageList.tsx:277`
  - `packages/desktop/src/renderer/pages/conversation/Messages/MessageList.tsx:789`
- **Problem:** MessageList declares `emptySlot` (MessageList.tsx:277) and centers it when there are zero messages (`if (processedList.length === 0 && emptySlot) return <div className='relative flex-1 h-full flex items-center justify-center'>{emptySlot}</div>` at :789-791). All three platform wrappers accept and forward it — AionrsChat.tsx:35/50/83, AcpChat.tsx:37/53/86, LegacyReadOnlyConversation.tsx:23/24/41. But ChatConversation.tsx never passes one: AionrsChat is rendered at :226-240 (inside the separate `AionrsConversationPanel` component, ChatConversation.tsx:145-243), LegacyReadOnlyConversation at :295, and AcpChat at :300-316 — none has an `emptySlot` prop. So every solo (non-team) conversation with zero messages shows a completely blank scroller. The team path proves the plumbing works end-to-end: TeamChatView.tsx:136-144 builds `emptySlot` once and passes it at :207, :221, :234. Note TeamChatEmptyState cannot be reused as-is: TeamChatEmptyState.tsx:94-99 returns null unless the conversation has a `team_id`.
- **Done when:** Create a new solo-conversation empty state component (e.g. packages/desktop/src/renderer/pages/conversation/components/ConversationEmptyState.tsx) showing the assistant avatar/name already resolved in ChatConversation (`presetAssistantInfo` / `assistantDisplayName` / `resolvedConversationBackend`) plus an i18n'd greeting; add its strings as new keys to all 12 locales' conversation.json, then `bun run i18n:types` + `node scripts/check-i18n.js`. Wire it in three places in ChatConversation.tsx: (1) pass `emptySlot={<ConversationEmptyState .../>}` to AcpChat at :300; (2) pass it to LegacyReadOnlyConversation at :295; (3) for the aionrs path, either build it inside `AionrsConversationPanel` (which already has `presetAssistantInfo` at :173) and pass it to AionrsChat at :226, or add an `emptySlot` prop to AionrsConversationPanel's signature at :145-148 and thread it from :344. No changes are needed in AionrsChat/AcpChat/LegacyReadOnlyConversation/MessageList — the prop already exists in all four. Done when a freshly created acp, aionrs, and legacy conversation each render a centered greeting instead of an empty scroller, and the team path is unchanged.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/team/components/TeamChatView.tsx:136-144 (single `emptySlot` const) and :207/:221/:234 (forwarded to every branch) — copy this shape exactly; packages/desktop/src/renderer/pages/team/components/TeamChatEmptyState.tsx:105-135 for the avatar-resolution and layout idiom (avatar → name → prompt chips that fill the draft)
- **Testing:** tests/unit/renderer/messageList.dom.test.tsx:879 already proves MessageList renders a passed emptySlot (`render(<MessageList emptySlot={<div>empty state</div>} />)`), so the new coverage belongs at the ChatConversation level: render ChatConversation with a stub conversation and an empty message list and assert the greeting appears. ChatConversation pulls in ChatLayout, CronJobManager, SWR and ipcBridge, so expect a fair amount of mocking — mirror the mock set in tests/unit/renderer/messageList.dom.test.tsx:21-90.

##### 14. NEW OBSERVATION: destructive permission approval uses brand-primary + warning-orange, not danger-red

- **Status:** `HOLDS` — holds exactly as originally found
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePermission.tsx:68`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePermission.tsx:87`
  - `packages/desktop/src/renderer/pages/conversation/Messages/components/MessagePermission.tsx:91`
- **Problem:** You asked for sites that disagree with the settled 'destructive = red / danger' decision. MessagePermission.tsx:68 renders the delete warning as `<Text className='text-13px text-warning'>{t('messages.permission.destructiveWarning')}</Text>` — orange, for a string that literally reads "This can permanently delete or overwrite files — it can't be undone." And at :87-91 the button that APPROVES that permanent deletion is `type={deEmphasize ? 'secondary' : 'primary'}`, i.e. brand-primary; the destructive handling only de-emphasizes 'always allow' (`deEmphasize = isDeny || (summary.destructive && isAlwaysAllow)`), never reddens the one-shot Allow. So the highest-stakes confirm in the chat UI looks like an ordinary primary action, while orange is being spent on data loss — the inverse of the convention.
- **Done when:** When `summary.destructive` is true: change :68 to `text-danger` (the token exists in uno.config.ts:23 as `var(--danger)`), and give the affirmative option Arco's danger styling — `status={summary.destructive && !isDeny ? 'danger' : undefined}` alongside the existing `type`. Leave non-destructive permission cards on primary. Keep the existing de-emphasis of 'always allow' for destructive actions (that logic at :84-87 is deliberate and commented). Do not touch uno.config.ts or the theme files. Done when a delete-permission card shows red warning text and a red Allow button, while a plain read/exec card is unchanged.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/components/settings/SettingsModal/contents/channels/LarkConfigForm.tsx:774 (`status='danger'` on an Arco Button); packages/desktop/src/renderer/components/settings/DirectorySelectionModal.tsx:200 (`text-danger` for a destructive message)
- **Testing:** jsdom: render MessagePermission with `action:'exec'` and a `description` that trips `summarizePermission`'s destructive detection (see Messages/components/permissionIntent.ts), then assert the option button carries Arco's danger class and the warning Text has `text-danger`.

##### 15. The composer's own outline is invisible in dark mode (`border-3` on `bg-dialog-fill-0`)

- **Status:** ❌ **VOID — FALSE POSITIVE, disproved in the running app (2026-07-31).**
  Do not re-open. `.sendbox-panel` carries an inline `style` (`SendBox/index.tsx:1425-1438`)
  that sets `borderColor` in **every** state — `activeBorderColor`/`inactiveBorderColor` from
  `useInputFocusRing`, or the drag highlight — and inline style beats the class. The `border-3`
  class therefore never painted anything in either theme. Measured over CDP: `rgb(77,75,135)`
  (#4D4B87) focused and `rgb(58,58,74)` (#3a3a4a) idle in dark against a `#1e2536` fill, and
  `rgb(201,202,207)` (#c9cacf) in light — a clearly visible edge the whole time.
  **Changing it to `border-4` would have changed nothing on screen while reading as "fixed".**
  What was real is the misleading dead class, removed in `68729a1c8` with a comment saying why
  no border-colour utility belongs there; the border was re-measured after removal and is
  byte-identical in both themes. The compiled-CSS block at the top of this doc is still right
  about what `border-3` *emits* — it was wrong to assume the class *wins*.
  ~~**Old status:** `HOLDS` — found during a later audit of this document, not in the original survey; verified at this tip~~
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/components/chat/SendBox/index.tsx:1424`
- **Problem:** The sendbox panel is `className={`sendbox-panel relative p-16px border-3 b bg-dialog-fill-0 b-solid rd-20px ...`}` — it paints a border with `border-3` on top of a `bg-dialog-fill-0` background. `uno.config.ts:213` merges `backgroundColors` into `theme.colors`, so `border-3` resolves to `var(--bg-3)`, and in the dark scheme `--bg-3` is `#1e2536` (`default-color-scheme.css:112`) which is byte-identical to `--dialog-fill-0` (`:158`). Border and fill are the same colour, so the composer — the most-used control in the app — has no visible edge in dark mode. This is the same trap already documented for the scroll-to-bottom ring in finding 9 and fixed in Stream 1's template gallery.
- **Done when:** `SendBox/index.tsx:1424` uses `border-4` instead of `border-3`, matching the resolution used elsewhere for this trap (`--bg-4` is `#2a3344` dark / `#d8cbb6` light — the only step that reads against both surfaces). Verify by eye in **both** themes per protocol item 7: the composer must have a visible edge in dark and must not look heavier than before in light. Do NOT change `--bg-3` or the theme files (frozen); fix at the call site. While you are there, sweep the rest of this stream's owned files for `border-3` on a `bg-dialog-fill-0`/card surface and fix them in the same commit rather than leaving a partial sweep.
- **Copy this in-repo pattern:** Stream 1 applied exactly this fix at `components/chat/TemplateGallery/TemplateGalleryExpanded.tsx` and `TemplateGalleryPanel.tsx` (panel border `b-1 b-solid border-4`) and on the template cards in `TemplateGalleryColumns.tsx`.
- **Testing:** Not meaningfully assertable in jsdom, which computes no colour. Assert the class in a DOM test if you want a regression guard (`expect(panel.className).toContain('border-4')`), and do the real check visually in dark mode.

### Stream 4 — Project home — 🟡 PARTIAL: finding #1 shipped, 10 remain

**Before starting: read `stream4-project-home-map.md` in this directory.** It is a
structural map of all five project-home components produced by three parallel
readers at `e1a0cb93a`, with per-finding landing points, in-file patterns to
reuse, and **39 hazards** — six load-bearing tests, Arco portalling, the Arco
`Message` legacy-render trap, and which apparent problems are deliberate. It
exists so this stream can be picked up cold.

- **#1 DONE — MR !26 open** (branch `feat/ui-project-home`, commit `2ac966ed1`,
  rebased onto `bf75fc373`, full suite 506 files / 4629 tests).
  Knowledge failure feedback: the row Retry/Delete and header Refresh were bare
  `void asyncCall()` with no catch at all, and two drop early-returns were fully
  silent. The hook's mutators now refetch in `finally` and rethrow. 7 strings × 12
  locales. Card tests 44 → 50.
- **#5 VOID** — drag-and-drop was already implemented by the kb-ui-polish rewrite.
- **REMAINING: #2, #3, #4, #6, #7, #8, #9, #10, #11, #12.** Branch off the current
  `origin/sprint1`, not off `feat/ui-project-home`, unless #1 has not merged yet.

#### ⚠️ RE-VERIFICATION at `bf75fc373` (2026-07-31) — four things the findings get wrong or lack

Independently re-derived at the current tip. **Every edit site is byte-exact**
(zero owned files changed in the 29 commits since the baseline). Corrections:

1. **#7's prescribed focus ring is known-dead — do not implement it as written.**
   Both routes the finding offers (`outline-1`-style utilities and
   `focus-visible:bg-fill-2`) are no-ops in this theme: the theme merges its
   numeric background scale into `theme.colors`, so `outline-1` compiles to
   `outline-color` with **no width**, and `focus-visible:bg-fill-3` was already
   proven to reach the stylesheet yet change nothing on screen. Use
   `ROW_FOCUS_RING` from `renderer/utils/ui/rowActivation.ts` (one arbitrary
   property) or a real `.row:focus-visible` rule in `ProjectChatList.module.css`.
   Following the finding literally passes lint, tsc and jsdom and **fails only by
   eye** — precisely the bug class this sweep exists to remove. Same applies to
   #4: use `activateOnEnterOrSpace` rather than a hand-rolled Enter/Space block.
2. **NEW finding #13 — two card-footer hairlines are invisible in dark.** S1's
   escalation told each stream to sweep its own surfaces; Stream 4 never was. Same
   defect class, **different token**: `border-t-light` → `--border-light`, which
   is `#1e2536` in dark (`default-color-scheme.css:141`) — byte-identical to
   `--dialog-fill-0` (`:158`), the Arco Card surface these dividers sit on. Two
   hits: `ProjectKnowledgeCard.tsx:453` and `ProjectFilesCard.tsx:100`. Verified
   **SAFE, do not touch**: `ProjectChatList.module.css:20` and
   `ProjectHeader.tsx:169` sit on `--bg-chat-surface` (`#0b0e14` dark), where that
   colour reads fine. Use `border-4` or `border-b-base`; pick one and stay
   consistent with any later sweep.
3. **#8 needs ZERO new locale keys** — `conversation.history.renamePlaceholder`
   already exists in all 12 locales ("Please enter a new name",
   en-US `conversation.json:117`). Reuse it; do **not** mint
   `projectHome.renamePlaceholder`. (Likewise `renameSuccess`/`renameFailed`/
   `deleteSuccess`/`deleteFailed` exist under `conversation.history` — reusing them
   for #3 would cut its churn from 6 new keys ×12 to 4. Copy call, not an
   engineering one.)
4. **`KnowledgeSourcePreview.tsx` is inside this stream's owns-glob but is NO
   LONGER Stream-4-only.** `pages/conversation/knowledge/KnowledgeCitationsContext.tsx`
   imports it (`:11`) and renders it (`:137`) for the KB citation drawer, passing
   an optional `anchor`. **Changing its prop contract breaks chat-side citations,
   which Stream 4 does not own.** No finding requires editing it — keep it that way.

Minor drift: `ipcBridge` `openFile` is `:177` and `showItemInFolder` `:178` (not
:174/:175); #6's `isMissingVectors` helper is lines 38-39 (not 36-39). Also note
`conversation.staleKnowledgeHint` is now `{body, action}` — `changedBody` was
removed by !22, so the escalation note describing three sub-keys is stale.

⛔ **Two hard blockers to settle before starting**, both in
`tests/unit/pages/project/ProjectHeader.dom.test.tsx`:
1. #8's declarative-Modal route — the test mocks Arco as
   `Modal: { ...actual.Modal, confirm }`; spreading a React component drops its
   statics, so a declarative `<Modal>` replacement will not render under test.
2. #3's remove fix — the test does not mock `projectStorage`, so `removeProject`
   runs for real against jsdom localStorage.

Suggested order once unblocked: error feedback (#2, #3) → small independents
(#6, #9, #10, #11, #12) → keyboard/a11y (#4, #7, reusing
`renderer/utils/ui/rowActivation.ts`) → #8 alone last, it is the `large` one and
rewrites two rename modals plus their tests.
Owns: `renderer/pages/project/**` (incl. `hooks/useProjectKnowledge.ts`).
Reference, read-only: `ProjectKnowledgeCard.tsx:339` has the correct
`group-focus-within` pattern — Streams 2/3 copy it, only Stream 4 edits the file.



#### Findings — verified against `d60397537`

**11 actionable, 1 void.** Every `path:line` below was re-checked at this tip; trust these over any older list.

> Numbering is stable: it reflects the original verification order, so a number is never reused. Void items keep their number and are listed at the end — if the notes below reference `#N`, that is this numbering.

> **Stream notes:** Verified read-only against tip d60397537 in /Users/lap16603/Projects/WePrompt/.claude/worktrees/ui-findings-verify. All 12 findings were opened and traced; no file in this stream is gone. Effect of the feat/kb-ui-polish rewrite on this stream: - ProjectKnowledgeCard.tsx is now 498 lines with icon-button headers (extra slot at :380-413), a passages row tooltip (:313-319), Embed-all (:115-124 and :467-477), reveal-folder (:382-393), an OCR tag (:223-241), progress labels (:205-215), and the Note tag removed. Every line number in the original findings is stale for this file; all locations above were re-read at this tip. - Finding 5 (drag-and-drop) is the ONLY one the rewrite actually fixed — implemented and unit-tested. - Findings 1, 4 and 6 survived the rewrite unchanged in substance. In particular useProjectKnowledge.ts:73-95 is byte-identical to the originally cited range. Cross-cutting facts an implementer needs: - ProjectKnowledgeCard.tsx, ProjectHeader.tsx and ProjectFilesCard.tsx have NO `Message` import; ProjectChatList.tsx (:12) and ProjectInstructionsCard.tsx (:9) do. Findings 1, 2 and 3 all reduce to "adopt the ProjectChatList toast pattern in the three silent components". - `updateProject` (packages/desktop/src/renderer/pages/conversation/projects/projectStorage.ts:143-177) both `return null` when the id is missing (:151) and `throw new Error('PROJECT_WORKSPACE_DUPLICATE')` (:160). Every caller in this stream ignores both: ProjectInstructionsCard.tsx:48, ProjectHeader.tsx:84 and :99, ProjectFilesCard.tsx:46, ProjectKnowledgeCard.tsx:134. That one fact drives findings 2 and 3 and part of 1. - i18n: 12 locale dirs under packages/desktop/src/renderer/services/i18n/locales/; every key named above lives under `projectHome` in conversation.json. After editing, run `bun run i18n:types` and `node scripts/check-i18n.js`. - Tests already exist for every component in this stream (tests/unit/pages/project/*.dom.test.tsx plus tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx and useProjectKnowledge.dom.test.ts). Two need editing rather than extending: the Modal.confirm stubs (finding 8 converts them to a declarative Modal) and ProjectChatList's Show-all cases (finding 9). - Suggested batching if split: (A) error feedback = 1+2+3 (one Message pattern, one locale pass); (B) keyboard/a11y = 4+7; (C) small independents = 6, 9, 10, 11, 12; (D) finding 8 alone (largest — rewrites two modals and their tests). - Out of scope but worth knowing: the sidebar conversation delete (packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts:101 and :135) and TeamSiderSection.tsx:261 also use orange `warning` for destructive actions, so fixing finding 12 makes Project Home stricter than the sidebar until someone widens the scope.

##### 1. Knowledge add/remove/retry/relink still fail silently (console.error only, no toast)

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** medium
- **Where:**
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:96-107`
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:104-106`
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:115-124`
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:126-139`
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:175-186`
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:180`
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:264-267`
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:288-291`
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:353`
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:400`
  - `packages/desktop/src/renderer/pages/project/hooks/useProjectKnowledge.ts:73-79`
  - `packages/desktop/src/renderer/pages/project/hooks/useProjectKnowledge.ts:81-87`
  - `packages/desktop/src/renderer/pages/project/hooks/useProjectKnowledge.ts:89-95`
  - `packages/desktop/src/renderer/pages/project/hooks/useProjectKnowledge.ts:97-105`
- **Problem:** The hook sites are byte-for-byte as originally reported: `addSources` (73-79), `removeSource` (81-87) and `retrySource` (89-95) are bare `await ipcBridge.projectKnowledge.*.invoke(...); await refetch();` with no try/catch and no user feedback. The card moved but did not improve: `handleAdd` still ends in `catch (addError) { console.error('Failed to add project knowledge sources:', addError); }` (104-106); `handleEmbedAll` (120-122), `handleRelink` (136-138) and `handleDrop` (181-185) all do the same console.error-only swallow. Worse, several call sites use bare `void` on a rejecting promise so the failure is an unhandled rejection with nothing logged at all: `void retrySource(source.id)` in the missing-vectors Retry (266) and the failed-source Retry (290), `onOk={() => void removeSource(source.id)}` on the delete Popconfirm (353), and `onClick={() => void syncNow()}` on Refresh (400). ProjectKnowledgeCard.tsx imports `Alert, Button, Card, Popconfirm, Spin, Tag, Tooltip` from Arco (line 12) — no `Message` at all, so this file physically cannot toast. Two silent no-ops also need feedback: `handleDrop` returns without a word when every dropped file was unsupported (`if (paths.length === 0) return;`, line 180) and when the folder is missing (line 178) — the existing test at tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx:608 locks in that a dropped .zip is dropped silently. `handleRelink` (126-139) additionally swallows the real `PROJECT_WORKSPACE_DUPLICATE` throw from `updateProject` (packages/desktop/src/renderer/pages/conversation/projects/projectStorage.ts:158-161), so picking a folder already owned by another project looks like nothing happened.
- **Done when:** Import `Message` from '@arco-design/web-react' into ProjectKnowledgeCard.tsx and give every mutation a user-visible outcome: (a) wrap `addSources`, `removeSource`, `retrySource` and `syncNow` call sites in try/catch (replace every `void fn()` with a named async handler that catches and calls `Message.error(t(...))`) — the ones at lines 266, 290, 353, 400 included; (b) new i18n keys under `conversation.projectHome` in all 12 locale dirs (packages/desktop/src/renderer/services/i18n/locales/*/conversation.json): `knowledgeAddFailed`, `knowledgeRemoveFailed`, `knowledgeRetryFailed`, `knowledgeRefreshFailed`, `knowledgeRelinkFailed`, `knowledgeDropUnsupported`; (c) `handleDrop` calls `Message.warning(t('conversation.projectHome.knowledgeDropUnsupported'))` instead of returning silently when `paths.length === 0` while `dataTransfer.files.length > 0` (reuse the existing `knowledgeSupportedTypes` copy in the body); (d) `handleRelink` shows `Message.error` on catch. Toasts may live in the hook instead of the card, but then all four mutations must be handled there consistently. Done when: every failing IPC path produces exactly one Arco toast, no `console.error` in this file lacks an accompanying Message call, and no `void <mutation>()` remains without a catch.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:80-83 (catch -> console.error + Message.error) and :112-122 (success -> Message.success, falsy result -> Message.error); packages/desktop/src/renderer/pages/conversation/projects/ProjectCreateModal.tsx:81 and :85
- **Testing:** tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx already mocks the whole hook (addSourcesMock/removeSourceMock/retrySourceMock) — make one reject and assert the toast. Arco `Message` is imperative and portals outside the RTL tree, so mock it the way tests/unit/pages/project/ProjectChatList.dom.test.tsx:49-61 does (`vi.mock('@arco-design/web-react', ...)` returning `Message: { success: vi.fn(), error: vi.fn() }`) and assert on the mock, not the DOM.

##### 2. ProjectInstructionsCard claims 'Instructions saved' even when the persist failed

- **Status:** `HOLDS` — holds exactly as originally found
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/project/components/ProjectInstructionsCard.tsx:47-51`
- **Problem:** Unchanged from the original report, same lines: `const handleSave = (): void => { updateProject({ id: project.id, instructions: draft.trim() }); setEditing(false); Message.success(t('conversation.projectHome.instructionsSaved')); };`. `updateProject` (packages/desktop/src/renderer/pages/conversation/projects/projectStorage.ts:143-177) has two failure modes this ignores: it `return null` when the id is not found (:151-153) and it `throw new Error('PROJECT_WORKSPACE_DUPLICATE')` (:160), plus `writeProjects` can throw on a storage failure. A null return still fires the success toast; a throw escapes the click handler with no message and loses the draft.
- **Done when:** `handleSave` becomes: `try { const updated = updateProject({ id: project.id, instructions: draft.trim() }); if (!updated) { Message.error(t('conversation.projectHome.instructionsSaveFailed')); return; } setEditing(false); Message.success(t('conversation.projectHome.instructionsSaved')); } catch { Message.error(t('conversation.projectHome.instructionsSaveFailed')); }` — `setEditing(false)` must move inside the success path so a failed save keeps the draft on screen. Add `conversation.projectHome.instructionsSaveFailed` to all 12 locale conversation.json files. Done when a test that makes `updateProject` return null (and one that makes it throw) asserts `Message.error` was called, `Message.success` was not, and the textarea is still visible.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:112-122 — success/failure branch on the return value plus a catch, each with its own Message call
- **Testing:** tests/unit/pages/project/ProjectInstructionsCard.dom.test.tsx already mocks `updateProject` (see the 'saves the trimmed draft and returns to the preview on Save' case at :82); add mockReturnValue(null) and a throwing mockImplementation variant.

##### 3. ProjectHeader rename / relink / remove swallow errors with no user-facing message

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** medium
- **Where:**
  - `packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:81-85`
  - `packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:91-103`
  - `packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:98-102`
  - `packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:120-142`
  - `packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:139-141`
  - `packages/desktop/src/renderer/pages/project/components/ProjectFilesCard.tsx:38-50`
  - `packages/desktop/src/renderer/pages/project/components/ProjectFilesCard.tsx:47-49`
- **Problem:** ProjectHeader.tsx still has no `Message` import (line 12 imports `Button, Dropdown, Input, Menu, Modal` only). Rename's `onOk` is unchanged at 81-85: `const trimmedName = nextName.trim(); if (!trimmedName) return; updateProject({ id: project.id, name: trimmedName });` — no try/catch, no null check, no success toast, and the empty-name path returns with zero feedback. Remove's `onOk` is 120-142 with the catch at 139-141: `catch (error) { console.error('Failed to remove project:', error); }` — a failure to detach chats or delete the project row leaves the user on an unchanged page. A third site in the same class that the original report missed: `handleRelink` at 91-103 catches and console.errors at 98-102, which is exactly where `updateProject`'s `PROJECT_WORKSPACE_DUPLICATE` throw lands (projectStorage.ts:160), so picking a folder another project already owns is silent. The identical relink swallow is duplicated in ProjectFilesCard.tsx:45-49 (`catch (relinkError) { console.error('Failed to relink project workspace:', relinkError); }`, also no Message import).
- **Done when:** Import `Message` into ProjectHeader.tsx and ProjectFilesCard.tsx. Rename: `try { if (!updateProject({ id: project.id, name: trimmedName })) { Message.error(t('conversation.projectHome.renameFailed')); return; } Message.success(t('conversation.projectHome.renameSuccess')); } catch { Message.error(t('conversation.projectHome.renameFailed')); }`. Remove: replace the bare console.error at 139-141 with console.error + `Message.error(t('conversation.projectHome.removeFailed'))`, and add `Message.success(t('conversation.projectHome.removeSuccess'))` before `navigate('/guid')`. Relink (all three copies — ProjectHeader.tsx:98-102, ProjectFilesCard.tsx:45-49, ProjectKnowledgeCard.tsx:136-138): `Message.error(t('conversation.projectHome.relinkFailed'))` in the catch, with the duplicate case distinguished by `error instanceof Error && error.message === 'PROJECT_WORKSPACE_DUPLICATE'` showing `conversation.projectHome.relinkDuplicate`. New keys `renameFailed`, `renameSuccess`, `removeFailed`, `removeSuccess`, `relinkFailed`, `relinkDuplicate` under `conversation.projectHome` in all 12 locales. Done when every catch in these three components pairs its console.error with a Message call and no mutation exits silently.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:104-123 — the sibling rename in this same stream already does return-value branching plus catch plus success/failure toasts
- **Testing:** tests/unit/pages/project/ProjectHeader.dom.test.tsx already stubs Modal.confirm to run `onOk` (see 'cleans up the project knowledge store after removing the project' at :120 and the rejection case at :131) and mocks `updateProject`/`removeProject`; add the Message mock from tests/unit/pages/project/ProjectChatList.dom.test.tsx:49-61 and assert Message.error on a throwing updateProject.

##### 4. Knowledge filename is a bare non-focusable <span onClick> and non-ready rows click into nothing

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:329-333`
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:330`
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:141-142`
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:32`
- **Problem:** The rewrite kept the defect and only moved it. Line 330 is still `<span className='min-w-0 flex-1 truncate text-13px text-t-primary' onClick={() => void handlePreview(source)}>` — no `role`, no `tabIndex`, no `onKeyDown`, and no `cursor-pointer`, so opening the preview drawer is mouse-only and the only affordance is the row's `hover:bg-fill-secondary` (line 325). `handlePreview` still early-returns on line 142 (`if (!isPreviewable(source)) return;`, where `isPreviewable` at line 32 is `source.status === 'ready'`), so a click on an indexing / failed / unsupported row is a dead click. The row tooltip (renderRowTooltip, 313-319) shows the passages line only for `status === 'ready'`, so a non-ready row's hover explains nothing about why the click did nothing.
- **Done when:** Compute `const previewable = isPreviewable(source);` in `renderRow` and drive the affordance off it: on the filename span set `role={previewable ? 'button' : undefined}`, `tabIndex={previewable ? 0 : undefined}`, `onKeyDown={previewable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void handlePreview(source); } } : undefined}`, `onClick={previewable ? () => void handlePreview(source) : undefined}`, and add `cursor-pointer` via `classNames(...)` (already imported at line 14) only when previewable. For the non-previewable case add a line to `renderRowTooltip` explaining there is nothing to open: new key `conversation.projectHome.knowledgePreviewNotReady` ('Nothing to preview yet — this file has not finished indexing.') rendered when `source.status !== 'ready'`, in all 12 locales. Do NOT make a non-ready row focusable — the fix removes the fake affordance rather than adding a no-op button. Done when: Tab reaches a ready filename and Enter/Space opens the drawer; an indexing/unsupported filename has no role, no tabIndex, no cursor-pointer, and its tooltip says why.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/conversation/Workspace/components/FileChangeList.tsx:107-124 — `onClick={expandable ? onToggle : undefined}` / `role={expandable ? 'button' : undefined}` / `tabIndex={expandable ? 0 : undefined}` / Enter+Space onKeyDown, exactly this conditional shape; also packages/desktop/src/renderer/pages/conversation/components/ConversationTitleMinimap/index.tsx:233-253 for the role/tabIndex/onKeyDown trio on a span
- **Testing:** tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx:427 ('previews the indexed text when a row is clicked') and :458 ('does not preview a source that has no indexed text yet') already cover the click paths — the second must stay green; add a keyboard case with `fireEvent.keyDown(screen.getByText('readme.md'), { key: 'Enter' })` plus an assertion that the unsupported row has no `role='button'`.

##### 6. Missing-vectors row shows a bare 'Retry' with no tag and no tooltip

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:258-272`
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:277-296`
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:36-39`
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:313-319`
- **Problem:** Still true, moved from 137-150 to 258-272. When `isMissingVectors(source)` (helper at 38-39: `status === 'ready' && vectorCount < chunkCount`) the `ready` branch renders only `<Button type='text' size='mini' className='flex-shrink-0' onClick={...}>{t('conversation.projectHome.knowledgeRetry')}</Button>` — no `Tag`, no `Tooltip`, so a naked 'Retry' sits next to a filename that shows no problem. The `failed` branch immediately below (277-296) does it right: `<Tooltip content={source.error}><Tag size='small' color='red'>Failed</Tag></Tooltip>` followed by Retry. The row tooltip (313-319) does not help: for a ready source it only adds the generic `knowledgePassagesTooltip` line, which says the file IS searchable. The footer's `knowledgeSemanticOff` note (454-466) only appears when `summary.semantic === 'off'`, so a project that has since gained an embedding model shows the bare Retry with no explanation at all.
- **Done when:** In the `isMissingVectors` branch (258-272) mirror the `failed` branch's structure: wrap the pair in `<span className='flex flex-shrink-0 items-center gap-4px'>` and, before the Retry button, render `<Tooltip content={t('conversation.projectHome.knowledgeNotEmbeddedDetail', { done: source.vectorCount, total: source.chunkCount })}><Tag size='small'>{t('conversation.projectHome.knowledgeStatusNotEmbedded')}</Tag></Tooltip>`. Use a neutral or orange tag (no `color` prop, or `color='orange'`) — not `color='red'`, which is reserved for `failed`; this state is degraded, not broken. New keys in all 12 locales: `knowledgeStatusNotEmbedded` ('Keyword only') and `knowledgeNotEmbeddedDetail` ('Searchable by keyword, but {{done}}/{{total}} passages have no embedding yet. Retry to embed them.'). Done when a ready source with vectorCount < chunkCount renders tag + tooltip + Retry, and a fully-embedded ready source still renders nothing (the existing 'leaves a ready row free of status jargon' and 'says nothing in the footer while everything is healthy' tests stay green).
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:277-296 — the in-file `failed` branch: Tooltip-wrapped Tag next to the Retry button, both inside one flex span
- **Testing:** tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx:319 ('offers retry on a ready source whose chunks are not all embedded') is the case to extend — assert the tag text renders and that `fireEvent.mouseEnter` on it reveals the detail copy (same technique as :469 and :480).

##### 7. ProjectChatList rows are unfocusable divs and the action cluster is hover-only (no group-focus-within)

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** medium
- **Where:**
  - `packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:199-207`
  - `packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:213-215`
  - `packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:216-219`
- **Problem:** Still true, shifted by a few lines. The row is `<div key=... className={classNames('group flex min-w-0 items-center gap-13px px-15px py-13px cursor-pointer transition-colors', styles.row)} onClick={() => navigate(`/conversation/${conversation.id}`)}>` (199-207) — `cursor-pointer` but no `role`, no `tabIndex`, no `onKeyDown`, so a chat cannot be opened from the keyboard. The relative-time span is `className='shrink-0 text-12px text-t-tertiary group-hover:hidden'` (213) and the pin/rename/delete cluster is `className='hidden shrink-0 items-center gap-4px group-hover:flex'` (217) — neither has a `group-focus-within` variant, so tabbing into the row's Arco Buttons (which are focusable) leaves them `display: none` and unreachable. ProjectChatList.module.css only defines `.row` divider/hover; there is no focus-visible rule anywhere.
- **Done when:** On the row div add `role='button'`, `tabIndex={0}` and `onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(`/conversation/${conversation.id}`); } }}`. Add focus variants to both spans: time becomes `group-hover:hidden group-focus-within:hidden`, actions become `hidden ... group-hover:flex group-focus-within:flex`. Add a visible focus ring — either `focus-visible:bg-fill-2 focus:outline-none` utilities or a `.row:focus-visible` rule in ProjectChatList.module.css using an existing semantic token (e.g. `outline: 1px solid var(--color-border-2)`); no hardcoded hex. Keep `event.stopPropagation()` on the action span (line 218) so Enter on a button does not also navigate. Done when: Tab focuses a chat row, Enter/Space opens it, and Tab again reveals and reaches pin/rename/delete without a mouse.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:339 — `opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100` is the correct in-stream pattern (it uses opacity, not `hidden`, which is why focus-within works there); packages/desktop/src/renderer/pages/conversation/Workspace/components/FileChangeList.tsx:107-124 for the row role/tabIndex/onKeyDown trio
- **Testing:** tests/unit/pages/project/ProjectChatList.dom.test.tsx:107 ('navigates to the conversation when a row is clicked') already grabs the row by `project-chat-row-<id>`; add `fireEvent.keyDown(row, { key: 'Enter' })` and assert navigateMock. jsdom does not evaluate Uno classes, so assert the className string contains `group-focus-within:` rather than computed visibility.

##### 8. Two divergent rename flows: project rename is a Modal.confirm with a bare Input (no Enter, no disabled-empty, no loading)

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** large
- **Where:**
  - `packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:66-89`
  - `packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:82-83`
  - `packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:88-129`
  - `packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:105-106`
- **Problem:** Both project-side rename flows are unchanged. Each builds `Modal.confirm({ content: <Input autoFocus defaultValue={...} onChange={(value) => { nextName = value; }} /> })` over a mutable `let nextName` closure: ProjectHeader.tsx:68-88 and ProjectChatList.tsx:91-126. Neither passes `onPressEnter`, `allowClear`, a `placeholder`, `okButtonProps={{ disabled: ... }}` or `confirmLoading`; because the Input is uncontrolled (`defaultValue` + closure variable) the OK button cannot react to emptiness at all. The empty-name path is a silent `if (!trimmedName) return;` — ProjectHeader.tsx:82-83 and ProjectChatList.tsx:105-106 — which dismisses the modal and does nothing. The sidebar and team flows use a real controlled `<Modal>` with all four affordances.
- **Done when:** Convert both to a controlled `<Modal>` rendered in JSX (not `Modal.confirm`), copying GroupedHistory/index.tsx:409-438: component state `renameVisible` / `renameName` / `renameLoading`; `<Modal visible={renameVisible} onOk={handleRenameConfirm} onCancel={...} okText cancelText confirmLoading={renameLoading} okButtonProps={{ disabled: !renameName.trim() }} style={{ borderRadius: '12px' }} alignCenter getPopupContainer={() => document.body}>` wrapping `<Input autoFocus value={renameName} onChange={setRenameName} onPressEnter={handleRenameConfirm} placeholder={t(...)} allowClear />`. With the OK button disabled while empty, the silent `if (!trimmedName) return;` guard becomes unreachable rather than invisible. Add `conversation.projectHome.renamePlaceholder` in all 12 locales, or reuse the existing `conversation.history.renamePlaceholder`. If only one fits the budget, do ProjectHeader first — it has neither a loading state nor any toast (finding 3). Done when: the OK button is greyed out for an empty/whitespace name, Enter submits, the button spins while the update is in flight, and no rename path exits without persisting or messaging.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx:409-438 (conversation rename) and packages/desktop/src/renderer/components/layout/Sider/TeamSiderSection.tsx:299-322 (team rename) — identical prop set in both, so it is an established repo pattern
- **Testing:** Both existing suites stub `Modal.confirm` to synchronously run `onOk` (tests/unit/pages/project/ProjectChatList.dom.test.tsx:49-61 and the same trick in ProjectHeader.dom.test.tsx), so converting to a declarative `<Modal>` breaks those stubs — the tests must be rewritten to render the real modal and drive it via `screen.getByRole`/`fireEvent.change` + `fireEvent.keyDown(input, { key: 'Enter' })`. Arco Modal portals to document.body, which RTL's `screen` queries do reach.

##### 9. 'Show all' in the project chat list cannot be collapsed again

- **Status:** `HOLDS` — holds exactly as originally found
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:56`
  - `packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:58-59`
  - `packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:172-181`
- **Problem:** Exactly as reported. `const [showAll, setShowAll] = useState(false);` (56); `hasHiddenChats = !showAll && chats.length > VISIBLE_ROW_COUNT` (59) so the control unmounts the moment it is used; and the button is `onClick={() => setShowAll(true)}` (177) — a one-way latch whose only escape is a page remount. `conversation.projectHome.showAll` exists (packages/desktop/src/renderer/services/i18n/locales/en-US/conversation.json:45); there is no `showLess`/`showFewer` key in any locale.
- **Done when:** Make it a toggle: keep the control mounted whenever `chats.length > VISIBLE_ROW_COUNT` (replace `hasHiddenChats` with `const isCollapsible = chats.length > VISIBLE_ROW_COUNT;`), set `onClick={() => setShowAll((previous) => !previous)}`, and label it `t(showAll ? 'conversation.projectHome.showLess' : 'conversation.projectHome.showAll')`. Add `showLess` ('Show less') under `projectHome` in all 12 locale conversation.json files, then run `bun run i18n:types` and `node scripts/check-i18n.js`. Optionally set `aria-expanded={showAll}` on the Button. Done when a 10-chat project can be expanded and re-collapsed to 5 rows, and the existing 'hides the "Show all" toggle once all chats are already shown' test is updated to expect the Show-less label instead of absence.
- **Copy this in-repo pattern:** No dedicated show-more/show-less component exists to copy; the `setState((previous) => !previous)` toggle idiom is used throughout the renderer (e.g. packages/desktop/src/renderer/pages/conversation/components/ChatTitleEditor.tsx).
- **Testing:** tests/unit/pages/project/ProjectChatList.dom.test.tsx:122 ('shows only the first 5 chats until "Show all" is clicked') and :137 both need updating; the t() mock returns the raw key, so assert on 'conversation.projectHome.showLess'.

##### 10. ProjectFilesCard's onOpenFile reveals in Finder instead of opening the file

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/project/components/ProjectFilesCard.tsx:97`
- **Problem:** Moved from :90 to :97, otherwise identical: `onOpenFile={(node) => void ipcBridge.shell.showItemInFolder.invoke(node.fullPath)}`. The prop belongs to the shared tree renderer `WorkspaceProjectFilesFlyout` (packages/desktop/src/renderer/pages/conversation/Workspace/components/WorkspaceProjectFilesFlyout.tsx:19, invoked at :76), and the other consumer of that contract opens an in-app preview: packages/desktop/src/renderer/pages/conversation/Workspace/index.tsx:492 passes `handleProjectFileOpen`, which calls `fileOpsHook.handlePreviewFile(node, true)` (index.tsx:442-460). So the same row click means 'preview this file' in a chat's Workspace tab and 'jump to Finder' on Project Home. The card also already has a dedicated reveal action in its `extra` slot (ProjectFilesCard.tsx:57-65), making the row's reveal behaviour redundant as well as surprising.
- **Done when:** Change line 97 to `onOpenFile={(node) => void ipcBridge.shell.openFile.invoke(node.fullPath)}` — `openFile` exists on the bridge (packages/desktop/src/common/adapter/ipcBridge.ts:174, same `(file_path: string) => Promise<void>` shape as showItemInFolder on :175) and is already how ProjectKnowledgeCard opens an original (ProjectKnowledgeCard.tsx:347 and :490). Keep the card's `extra` reveal button as the explicit 'show me in Finder' path. The card is documented read-only (`filesReadonly` footnote, lines 100-102), so launching the OS default app rather than an editable in-app preview is the right scope here. Done when clicking a file row launches the file in its default application and the reveal-in-folder action is the only thing that opens Finder.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:347 — `onClick={() => void ipcBridge.shell.openFile.invoke(filePathOf(source.fileName))}` for the 'Open original' action
- **Testing:** tests/unit/pages/project/ProjectFilesCard.dom.test.tsx already mocks the ipcBridge shell namespace; assert that clicking a leaf row calls `openFile` and not `showItemInFolder`, and that the header reveal button still calls `showItemInFolder`.

##### 11. ProjectHeader's active-duration token and truncated workspace path have no tooltips

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:41-47`
  - `packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:61-64`
  - `packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:173-176`
  - `packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:180`
- **Problem:** `formatActiveDuration` (41-47) emits a bare '5m'/'3h'/'2d'/'1w' token; it is rendered at line 180 as `<span className='shrink-0'>{t('conversation.projectHome.metaActive', { time: activeTime })}</span>` with no Arco `Tooltip` and no `title`, so the exact timestamp is unreachable. The workspace path at 175 is `<span className='truncate'>{project.workspace}</span>` inside a `min-w-0 max-w-full` flex span — truncated with no tooltip either. Two corrections to the original report: (a) the `project.last_opened_at ?? project.updated_at` fallback at line 62 is now largely transient, because `useProjectHome` stamps `last_opened_at` on mount (packages/desktop/src/renderer/pages/project/hooks/useProjectHome.ts:31-36), so a stale-metadata reading only appears on the first paint of a never-before-opened project — the fallback is still in the code but is no longer the main problem; (b) an extra real defect at 61-64: `Date.now()` is captured inside a `useMemo` keyed only on the two timestamps, so the token never re-ticks while the page stays open.
- **Done when:** Wrap both meta items in Arco `Tooltip` (import it — line 12 currently imports `Button, Dropdown, Input, Menu, Modal`): the path span at 173-176 gets `<Tooltip content={project.workspace}>`, and the active token at 180 gets `<Tooltip content={new Date(project.last_opened_at ?? project.updated_at).toLocaleString()}>`. If the distinction matters, add a `conversation.projectHome.metaActiveExactUnknown` variant (12 locales) used when `last_opened_at` is undefined so an `updated_at` value is not presented as a last-open time. Follow the rule stated in ProjectKnowledgeCard.tsx:327-329: use the Arco Tooltip, never a native `title` alongside it. Done when hovering the path shows the full absolute path and hovering 'active 2d' shows a locale-formatted absolute date-time.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/settings/ToolsSettings/McpServerHeader.tsx:56 (`new Date(timestamp).toLocaleString()` is the repo's absolute-timestamp formatter); packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:329-333 for Tooltip-wrapping a truncated span
- **Testing:** tests/unit/pages/project/ProjectHeader.dom.test.tsx:103 ('renders the project name and the chats/active subline') is the anchor. That suite mocks Dropdown/Menu; Arco Tooltip content only mounts on hover, so trigger it with `fireEvent.mouseEnter` and `await screen.findByText(...)`, the way tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx:469 does.

##### 12. Destructive-confirm styling: chat delete is orange, and the knowledge Popconfirm's OK button is not danger-styled

- **Status:** `PARTIALLY_FIXED` — partly fixed upstream — only the sites below remain
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:133-156`
  - `packages/desktop/src/renderer/pages/project/components/ProjectChatList.tsx:138`
  - `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:350-363`
  - `packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:110-145`
  - `packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:119`
- **Problem:** Three destructive confirms exist in pages/project/**, and they disagree. (1) VIOLATION — ProjectChatList.tsx:138 deletes a conversation with `okButtonProps: { status: 'warning' }` (orange) inside `Modal.confirm` (133-156); deleting a chat removes user data, so the settled rule requires red. (2) PARTIAL — ProjectKnowledgeCard.tsx:350-363 moves a file to the Trash via `<Popconfirm title=... okText=... onOk=...>`: the trigger icon button carries `status='danger'` (line 358) but the Popconfirm passes no `okButtonProps`, so the confirm's OK button renders as the default primary (brand orange #F05A22 via ConfigProvider, packages/desktop/src/renderer/main.tsx:272) — the confirmation step is not danger-styled, though the settled rule permits a Popconfirm here only in its danger form. (3) COMPLIANT — ProjectHeader.tsx:119 already uses `okButtonProps: { status: 'danger' }` for project removal and the menu entry is `className='!text-danger-6'` (line 159).
- **Done when:** (1) ProjectChatList.tsx:138 -> `okButtonProps: { status: 'danger' }`. (2) ProjectKnowledgeCard.tsx:350 -> add `okButtonProps={{ status: 'danger' }}` to the `<Popconfirm>` (Arco supports it: node_modules/@arco-design/web-react/es/Popconfirm/interface.d.ts:58) and keep the danger trigger button as-is. (3) leave ProjectHeader alone. Do not swap Modal.confirm for Popconfirm or vice versa — a single chat and a single file are small items, a project is a container, so the current component choices already match the settled rule. Done when `grep -rnE "status: 'warning'|status='warning'" packages/desktop/src/renderer/pages/project/ (NOTE: -E is required — without it the `|` is literal, the grep returns zero hits, and the finding looks already-fixed)` returns nothing and all three confirms render a red OK button.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/project/components/ProjectHeader.tsx:119 (in-stream, compliant); packages/desktop/src/renderer/pages/settings/AssistantSettings/DeleteAssistantModal.tsx:31 (declarative) and packages/desktop/src/renderer/pages/team/TeamPage.tsx:597 (imperative). No in-repo Popconfirm passes danger okButtonProps yet, so ProjectKnowledgeCard would be the first — follow the Modal precedent for the value.
- **Testing:** tests/unit/pages/project/ProjectChatList.dom.test.tsx captures the Modal.confirm options in `modalConfirmMock` (:49-61, delete case at :198) — assert `modalConfirmMock.mock.calls[0][0].okButtonProps` equals `{ status: 'danger' }`. For the Popconfirm, tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx:348/:358 already drives the confirm; asserting the OK button's status in jsdom means matching Arco's danger class, which is brittle — a props-level assertion via a light Popconfirm mock is more reliable.

##### Void — verified fixed or gone; do not spend time here

- **#5. Knowledge card drag-and-drop upload** — `ALREADY_FIXED`. `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:153-201`, `packages/desktop/src/renderer/pages/project/components/ProjectKnowledgeCard.tsx:376-379`
  - No longer true. The feat/kb-ui-polish rewrite added full drop support: `pathsFromDrop` (155-173) resolves paths via `window.electronAPI.getPathForFile` and filters with `isSupportedFile`, `handleDrop` (175-186), `handleDragOver` (188-193) and `handleDragLeave` (195-201) are wired onto the `Card` at 377-379, with a drag highlight (`classNames(dragging && '!border-dashed !border-primary-5 !bg-fill-1')`, line 376) and directory entries skipped. Covered by tests/unit/renderer/ProjectKnowledgeCard.dom.test.tsx:599-625. The only residual gap is feedback when every dropped file is unsupported, which finding 1 covers.

### Stream 5 — Settings, modals & chrome
Owns: `renderer/pages/settings/**`, `renderer/components/base/AionModal.tsx`,
`renderer/components/settings/**`, `renderer/components/layout/Layout.tsx`,
`renderer/components/layout/WindowControls.tsx`,
`renderer/pages/conversation/components/ChatLayout/**`.
MUST NOT touch: `components/layout/Sider/**` (Stream 2).
Note: `AionModal.tsx` is rendered app-wide — the aria-label/close-color fix is
behavior-shared but the file is exclusively Stream 5's, so no code conflict.
Dropped upstream: `ApiKeyEditorModal.tsx` no longer exists — skip that item.

#### ⚠️ RE-VERIFICATION at `bf75fc373` (2026-07-31) — read before implementing

Independently re-derived at the current tip, 29 commits past the findings
baseline. **All ~30 `path:line` citations below are byte-exact** (no owned file
changed in those commits) and both void items re-confirm as void. But three
prescriptions are wrong, and following the doc literally ships regressions:

1. **Finding #1's fix as written causes a visual regression.**
   `CLOSE_BUTTON_CLASS` (`AionModal.tsx:116-117`) sets **no text colour**, so
   replacing `fill='#86909c'` with `fill='currentColor'` makes the close X
   inherit modal *body* text colour (`#e6ecf5` in dark) — a bright X where a
   mid-grey affordance belongs. The fix must ALSO add `text-t-secondary` to
   `CLOSE_BUTTON_CLASS`, matching `STD_CLOSE_BTN_CLASS` (`:131-132`). Note the
   finding's own grep-based acceptance passes *without* this, so the gate will
   not catch it — check by eye.
2. **Finding #2 is bigger than stated, and one route turns the gate red.**
   **Four** of the five files lack `useTranslation`, not one. `WindowControls.tsx`
   has an early `if (!available) return null` at `:63` — the hook must go ABOVE
   it or `react-hooks/rules-of-hooks` fires, and the gate is judged by lint
   ERRORS (0-error baseline), so a misplaced hook turns it red. Three implicit-
   return arrows need block bodies (`MobileWorkspaceOverlay.tsx`, and BOTH
   `WorkspacePanelHeader` and `DesktopWorkspaceToggle` in
   `WorkspacePanelHeader.tsx`). Its grep baseline is stale: **12 hits now, not
   13** — S2 already fixed `ConversationSearchPopover`.
3. **Finding #8's "migrate everything" option was understated ~4×** — it is
   ~20 declarative `<Modal>` sites across 16 files plus 11 `Modal.confirm` sites,
   crossing every stream's ownership *and* unowned files (`main.tsx`,
   `UpdateNotificationCard`), and it misses a **third** chrome entirely:
   `components/base/ModalWrapper.tsx`. See the answer in Stream 0 decisions —
   this reinforces "write the rule down".

**One same-class defect the findings missed:** `DirectorySelectionModal`'s row
separators use `border-b-light` → `--border-light`, which is `#1e2536` in dark —
byte-identical to `--dialog-fill-0`, so they are invisible on the dialog fill for
exactly the reason finding #11 describes. Fix it alongside #11. (The `--bg-3`
escalation does not name this token; it is a second instance of the same bug.)

**Dispatcher rulings for this stream (2026-07-31):**
- **Finding #2 copy: use "Project", not "workspace".** The app's own visible
  string for that panel is "Project" (`common.json:12`, `conversation.json`
  `workspace.title`), so a screen-reader label saying "workspace" names something
  that appears nowhere on screen. New keys go in `common.json` per the locale
  table — **not** under `conversation.json`'s existing `workspace` object.
- **Finding #10: sticky reveal is approved.** A masked multi-key textarea needs
  reveal to persist for the modal session (a user editing a 3-key rotation must
  see what they are editing). The existing descope guard still applies: if the
  reveal affordance starts growing, ship only the `AddPlatformModal` half.
- **`ModalWrapper.tsx` is OUT of scope** — it carries finding #1's identical
  `fill='#86909c'` bug but is not in this stream's owns list. Do not reach for
  it; it is consumed only by `pages/TestShowcase.tsx`, so the honest fix is
  deletion in a separate change. Leave a note, don't fix it here.
- **`common.json` is no longer S5-exclusive:** `f8a3c29f2` (team white-screen
  fix) added a nested `common.routeError` block to all 12 locales. On rebase take
  the incoming file wholesale and re-apply your block — do not clobber it.
- **Finding #9 changes a locale VALUE, not a key.** `check-i18n.js` compares key
  presence only, so a locale you forget to reword keeps the un-interpolated
  string and still passes. Verify `{{name}}` appears in all 12 by hand.

#### Findings — verified against `d60397537`

**8 actionable, 1 needs-a-decision (#8), 2 void.** Every `path:line` below was re-checked at this tip; trust these over any older list.

> Numbering is stable: it reflects the original verification order, so a number is never reused. Void items keep their number and are listed at the end — if the notes below reference `#N`, that is this numbering.

> **Stream notes:** VERIFICATION CONTEXT: clean read-only worktree at sprint1 tip d60397537 ("Merge branch 'feat/kb-citation-clickthrough' into 'sprint1'"). No files were modified. VOID FINDING CONFIRMED: pages/settings/components/ApiKeyEditorModal.tsx is gone — `find . -name "ApiKeyEditorModal*" -not -path "*/node_modules/*"` returns nothing. Deleted upstream in 826eba76c. Do not chase it. HOWEVER the underlying defect class survived in two OTHER surfaces — reported as finding #10 below (the item the scope asked me to sweep for). TWO OF THE NINE FINDINGS ARE NOW DEAD — do not spend implementer time on them: - #6 (AddModelModal dead code) is ALREADY_FIXED. The file is 184 lines, has zero commented-out JSX, no previewModels/remainingCount, and imports only {Select} from Arco + {PreviewOpen} from icon-park. Nothing to delete. - #7 (fixed pixel modal heights) is ALREADY_FIXED. Both `height: 450`/`420-80` in JsonImportModal and `560`/`560-96` in OneClickImportModal are gone; those modals now pass only `style={{ width: 600 }}` / `style={{ width: 680 }}`. The only surviving fixed height is `height='300px'` on the CodeMirror instance at JsonImportModal.tsx:349, which is a legitimately internally-scrolling editor, not a modal shell — leave it. The finding's premise that AddModelModal uses `maxHeight:'90vh'` as the parity reference is ALSO void: AddModelModal now sets no height/maxHeight at all and just inherits AionModal defaults, and the "parity with AddModelModal" comment no longer exists in JsonImportModal. TWO NEW FINDINGS ADDED that were not in the original list but sit squarely in this stream and are higher-value than several that were: - #10: plaintext API-key inputs (this is the sweep the scope explicitly requested; AddPlatformModal.tsx:553 is a clean drop-in fix, EditModeModal.tsx:236 is NOT a drop-in because it is deliberately multi-line — read that finding's problem text before touching it). - #11: the KNOWN DARK-MODE TRAP is present in AionModal itself, i.e. it silently affects every modal in the app. I proved this from the theme file rather than assuming it: --bg-3 is #1e2536 in dark (default-color-scheme.css:112) and --dialog-fill-0 is also #1e2536 (default-color-scheme.css:158), while AionModal's content background is hardcoded to var(--dialog-fill-0) (AionModal.tsx:216,278). Same-colour-on-same-colour, so the header rule and footer rule are literally invisible in dark mode. This is probably the highest impact-per-line item in the stream. COUNT CORRECTIONS — the original findings undercounted sites; a fix that only touches the cited lines will be half-done: - #2 listed 6 aria-label sites; the verified Where list below has 10 sites (11 strings — WindowControls.tsx:87 is a Restore/Maximize ternary). Trust the Where list, not any headline count. Extra: WindowControls.tsx:87 (the Restore/Maximize ternary, same defect) and Layout.tsx:373 (a hardcoded `title` attribute on the same button as the cited aria-label — a11y fix must do both or the tooltip stays English). - #9's "doesn't name the server" defect exists at TWO sites, not one: McpManagement.tsx:240 and ToolsModalContent.tsx:291 are near-identical copy-pasted delete modals. Same for #5: McpServerToolsList renders through TWO parents (McpManagement.tsx:186,202 and ToolsModalContent.tsx:236,251), so verify the empty state in both the standalone Tools page and the settings-modal Tools tab. ONE FINDING PARTLY CONTRADICTED ITS OWN PREMISE: #8 claimed DirectorySelectionModal is a raw Arco Modal. It is not — it migrated to AionModal (DirectorySelectionModal.tsx:13,144). The AionModal-vs-raw-Modal split is real but the membership list changed; I re-derived it from scratch in #8's problem text. A GENUINE NEW RULE VIOLATION: SkillsHubSettings.tsx:310 styles BATCH skill deletion as `status: 'warning'` (orange) while single-skill deletion at :867 in the same file correctly uses `status: 'danger'`. Batch delete destroys strictly more user data than single delete, so this inverts the settled rule and is self-inconsistent within one file. Everything else in this stream already complies with the red rule (DeleteAssistantModal.tsx:31, McpManagement.tsx:236, SkillConfirmModals.tsx:54,88, SkillsHubSettings.tsx:867), so #9's destructive-styling half is otherwise ALREADY_FIXED. I18N GROUNDWORK ALREADY DONE FOR THE IMPLEMENTER (all in packages/desktop/src/renderer/services/i18n/locales/<locale>/, 12 locales confirmed: de-DE, en-US, es-ES, fa-IR, ja-JP, ko-KR, pt-BR, ru-RU, tr-TR, uk-UA, zh-CN, zh-TW). Keys that ALREADY EXIST and should be reused rather than re-invented: common.close (common.json:30), common.collapse (:38), common.expand (:146), common.retry (:31), settings.mcpImportFailed (settings.json:719), and a large family of specific settings.mcpError* strings (settings.json:681-694) that finding #3 can surface instead of swallowing. Keys that must be CREATED: minimize/maximize/restore/toggle-workspace labels (#2), an empty-tools string for #5, and an empty-folder string for #4 (note fileSelection.json is tiny — only 4 keys — so that is where the #4 string belongs). CROSS-STREAM BOUNDARY RESPECTED: I did not report anything in components/layout/Sider/** (Stream 2). Layout.tsx findings are on the titlebar button inside Layout.tsx itself, not Sider. ONE THING I DELIBERATELY DID NOT FLAG AS A FINDING: several in-scope raw `<button>` elements exist (AionModal.tsx:380,400; WindowControls.tsx:80,84,92; WorkspacePanelHeader.tsx:38,53,64; SkillsHubSettings.tsx:856). Per AGENTS.md the no-raw-interactive-HTML rule is a ratchet that applies to new/meaningfully-modified UI, and these are pre-existing and styled by dedicated CSS classes, so converting them is not required by the findings above. Be aware that fixes #1 and #2 will touch those exact elements — add the i18n'd aria-label without converting them to Arco Button, otherwise the change balloons and the custom titlebar/close styling breaks.

##### 1. AionModal close button: hardcoded English aria-label and hardcoded hex icon fill

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/components/base/AionModal.tsx:380`
  - `packages/desktop/src/renderer/components/base/AionModal.tsx:400`
  - `packages/desktop/src/renderer/components/base/AionModal.tsx:401`
- **Problem:** The finding cited :348-349; the code moved. There are now TWO close buttons in the same renderHeader(), one per variant. The 'standard' variant at :380 has `aria-label='Close'` and its icon is already correct (`<Close size={20} fill='currentColor' />` at :381). The default variant at :400 has BOTH defects: `aria-label='Close'` and `<Close size={20} fill='#86909c' />` at :401. Because this is the base modal, both defects propagate to every AionModal in the app (12 in-scope callers alone). The hex #86909c is a hardcoded value where semantic tokens are mandatory, and it does not respond to theme.
- **Done when:** Both buttons read `aria-label={t('common.close')}` — the key already exists at packages/desktop/src/renderer/services/i18n/locales/en-US/common.json:30 with value "Close", so no new key or locale edits are needed, only the useTranslation `t` already in scope in this component. Line 401's `fill='#86909c'` becomes `fill='currentColor'` so it matches its sibling at :381 exactly; do NOT substitute another hex or an iconColors entry — currentColor is the pattern already used one variant over and lets CLOSE_BUTTON_CLASS control the colour. Done when `grep -n "aria-label='Close'\|#86909c" packages/desktop/src/renderer/components/base/AionModal.tsx` returns nothing.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/components/base/AionModal.tsx:381 — the sibling close icon in the same function already uses fill='currentColor' correctly
- **Testing:** Render any AionModal (e.g. via tests/unit/renderer for an existing modal) and assert getByLabelText matches the translated close string rather than the literal 'Close'. Pure-string change otherwise; jsdom handles this fine. Visually confirm the default-variant close icon still greys correctly in both themes.

##### 2. Ten hardcoded English aria-label/title sites across window chrome and workspace toggles

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** medium
- **Where:**
  - `packages/desktop/src/renderer/components/layout/WindowControls.tsx:80`
  - `packages/desktop/src/renderer/components/layout/WindowControls.tsx:87`
  - `packages/desktop/src/renderer/components/layout/WindowControls.tsx:95`
  - `packages/desktop/src/renderer/components/layout/Layout.tsx:373`
  - `packages/desktop/src/renderer/components/layout/Layout.tsx:374`
  - `packages/desktop/src/renderer/pages/conversation/components/ChatLayout/WorkspacePanelHeader.tsx:40`
  - `packages/desktop/src/renderer/pages/conversation/components/ChatLayout/WorkspacePanelHeader.tsx:54`
  - `packages/desktop/src/renderer/pages/conversation/components/ChatLayout/WorkspacePanelHeader.tsx:68`
  - `packages/desktop/src/renderer/pages/conversation/components/ChatLayout/index.tsx:202`
  - `packages/desktop/src/renderer/pages/conversation/components/ChatLayout/MobileWorkspaceOverlay.tsx:85`
- **Problem:** Still true, and the original count was low. Confirmed English literals: WindowControls.tsx:80 `aria-label='Minimize'`, :87 `aria-label={isMaximized ? 'Restore' : 'Maximize'}` (NOT in the original finding, same defect), :95 `aria-label='Close'`. Layout.tsx moved from the cited :353 to :374 `aria-label='Collapse sidebar'`, and the SAME button also carries `title='Collapse sidebar'` at :373 (NOT in the original finding — fixing only the aria-label leaves an English tooltip). WorkspacePanelHeader.tsx:40 and :54 `aria-label='Toggle workspace'`, :68 `aria-label='Expand workspace'`. ChatLayout/index.tsx:202 `aria-label='Toggle workspace'`. MobileWorkspaceOverlay.tsx:85 `aria-label='Collapse workspace'`. Screen-reader users on 11 of 12 locales hear English.
- **Done when:** Every listed attribute becomes a `t(...)` call. Reuse existing keys where they fit: common.close for WindowControls.tsx:95 (common.json:30), common.collapse (:38) and common.expand (:146) for the collapse/expand toggles. Create new keys in common.json for the rest — minimize, maximize, restore — plus one for the workspace toggle (conversation.json already has a `workspace` object at line 441 if you prefer to scope it there). Layout.tsx:373's `title` must be translated too, not just :374. Add every new key to all 12 locale dirs (de-DE, en-US, es-ES, fa-IR, ja-JP, ko-KR, pt-BR, ru-RU, tr-TR, uk-UA, zh-CN, zh-TW). WorkspacePanelHeader.tsx is currently a prop-only arrow component with no `t` in scope — it needs `const { t } = useTranslation()`, which means converting the implicit-return arrow to a block body. Done when the five files in the Where list are clean, `bun run i18n:types` regenerates cleanly, and `node scripts/check-i18n.js` passes. **Scope the check to those five files, not the whole renderer** — `grep -rnE "aria-label='[A-Z]|title='[A-Z][a-z]* [a-z]" packages/desktop/src/renderer/` returns 13 hits, two of which this stream can never clear: `components/media/WebviewHost.tsx:683` (`title='Reset zoom'`, owned by no stream — leave it and note it) and `GroupedHistory/ConversationSearchPopover.tsx:515` (that one is Stream 2 finding 6). Also note the grep is **blind to one of your own sites**: `WindowControls.tsx:87` is `aria-label={isMaximized ? 'Restore' : 'Maximize'}` — a brace, not a quote — so a passing grep does not prove this finding is done. Check the Where list by hand.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/components/layout/Layout.tsx:353 — `aria-label={t('common.back', { defaultValue: 'Back to Chat' })}` is the correct in-repo pattern sitting 20 lines above the offender in the very same file
- **Testing:** Existing DOM tests that query these controls by their English accessible name will break — grep tests/unit/renderer for getByLabelText('Close'|'Minimize'|'Toggle workspace') before renaming and update them to the translated string. Then run node scripts/check-i18n.js to prove all 12 locales carry the new keys.

##### 3. OneClickImportModal reports genuine CLI/permission/parse failures as 'No MCP servers found'

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** medium
- **Where:**
  - `packages/desktop/src/renderer/pages/settings/components/OneClickImportModal.tsx:210`
  - `packages/desktop/src/renderer/pages/settings/components/OneClickImportModal.tsx:211`
  - `packages/desktop/src/renderer/pages/settings/components/OneClickImportModal.tsx:212`
  - `packages/desktop/src/renderer/pages/settings/components/OneClickImportModal.tsx:322`
  - `packages/desktop/src/renderer/pages/settings/components/OneClickImportModal.tsx:187`
  - `packages/desktop/src/renderer/pages/settings/components/OneClickImportModal.tsx:188`
  - `packages/desktop/src/renderer/pages/settings/components/OneClickImportModal.tsx:428`
  - `packages/desktop/src/renderer/pages/settings/components/OneClickImportModal.tsx:432`
- **Problem:** All three sub-defects hold, at shifted lines. (a) handleImportFromCLI's catch at :210-213 does `console.error('Failed to import from CLI:', error); setFetchedServers([]);` — it stores no error state, so the render at :322 falls through to `<div className='text-center py-8 text-t-secondary'>{t('settings.mcpNoServersFound')}</div>`. Claude/Codex CLI not installed, a permission-denied read, and a malformed config all display as the reassuring 'No MCP servers found'; the user has no signal to retry or fix anything. (b) handleBatchImport failure at :187-189 is likewise only console.error'd — the catch swallows it, currentStep never advances to 3, and the user sees the button stop spinning with no message. (c) The AionSteps check icons at :428 and :432 hardcode `fill='#165dff'` while the very same file uses the token `fill={iconColors.success}` at :293 and :332.
- **Done when:** Add `const [importError, setImportError] = useState<string | null>(null);` Set it in the :210 catch (and clear it at the top of handleImportFromCLI alongside setLoadingImport(true), and in the visible-reset effect at :157-168). In renderStep2, branch on importError BEFORE the fetchedServers.length check so a real failure renders an error state with a retry control rather than the empty string — the existing settings.mcpImportFailed key (settings.json:719, "Import failed") plus common.retry (common.json:31) cover the copy, and settings.json:681-694 already holds specific settings.mcpError* strings worth surfacing when the error matches. Reserve settings.mcpNoServersFound for the genuine success-with-zero-results case only. For (b), surface the batch failure via Arco `Message.error(...)` in the :187 catch instead of only logging. For (c), replace both `fill='#165dff'` with `fill={iconColors.brand}` — iconColors is already imported at line 7 and `brand: 'var(--brand)'` is defined at packages/desktop/src/renderer/styles/colors.ts:109. Done when no hex literal remains in the file and CLI-absent vs zero-servers render visibly different states.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/components/settings/DirectorySelectionModal.tsx:199-206 — an error branch that stores the message in state and renders it with a retry Button, i.e. exactly the shape this modal is missing; for the icon token, OneClickImportModal.tsx:293 in this same file
- **Testing:** Mock mcpService.getAgentMcpConfigs.invoke to reject, render at step 2, and assert the error/retry copy appears and settings.mcpNoServersFound does NOT. Add a second case resolving to a config with servers: [] and assert the opposite. Both are plain jsdom render assertions.

##### 4. DirectorySelectionModal: no empty-folder state, mouse-only rows, emoji concatenated outside i18n

- ➕ **ALSO FIX WHILE YOU ARE IN THESE ROWS — invisible row separators in dark.**
  Added 2026-07-31 out of Stream 4's work; verified in this repo, not inferred. The
  separators at `DirectorySelectionModal.tsx:192` (the go-up row) and `:210` (each
  item row) use `border-b border-b-light`. `--border-light` is `#eceef1` light but
  **`#1e2536`** dark (`themes/default-color-scheme.css:57` / `:141`) —
  byte-identical to `--dialog-fill-0` (`:158`), and
  `body[arco-theme='dark'] .arco-modal-content` is set to exactly that
  (`arco-override.css:181`). So in dark the list has no visible row separation at
  all. These are the *same* rows this finding already makes keyboard-reachable, so
  do both in one pass rather than as a separate MR.
  - A **second token** with the defect the `--bg-3` escalation describes, which
    that escalation never names. Same class, different variable.
  - ⚠️ **A grep for `border-light` finds none of these** — the utility is
    `border-b-light`. Use `grep -rnE "border-(t|b|l|r|x|y)-light\b"`.
  - ⚠️ **Do not assume `border-b-4` is the fix.** Numeric keys in this theme are
    merged into `theme.colors`, so a numeric border utility may compile to a
    *colour* rather than the width you expect — this is why `outline-1` sets
    `outline-color`. **Generate the CSS and confirm before relying on it**; if it is
    ambiguous, use one arbitrary property such as
    `[border-bottom:1px_solid_var(--bg-4)]`, which is what Stream 2 settled on for
    the focus ring after hitting exactly this.
  - Sibling sites in the same class, documented for Stream 4 and **not** yours:
    `ProjectKnowledgeCard.tsx:502`, `ProjectFilesCard.tsx:100`. Verified safe and
    not to touch: `ProjectHeader.tsx:169` — it sits on `--bg-chat-surface`
    (`#0b0e14` in dark), where the hairline reads fine.

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** medium
- **Where:**
  - `packages/desktop/src/renderer/components/settings/DirectorySelectionModal.tsx:207`
  - `packages/desktop/src/renderer/components/settings/DirectorySelectionModal.tsx:191`
  - `packages/desktop/src/renderer/components/settings/DirectorySelectionModal.tsx:208`
  - `packages/desktop/src/renderer/components/settings/DirectorySelectionModal.tsx:148`
- **Problem:** All three hold at shifted lines. (a) The list renders loading via the Spin wrapper at :187 and an error branch at :199-206, but `directoryData.items.map(...)` at :207-236 has no empty guard, so browsing into a genuinely empty directory paints a blank 400px box with no explanation. (b) Every row is a bare `<div onClick>`: the go-up row at :191-197 (onClick={handleGoUp}) and each item row at :208-214 (onClick + onDoubleClick) carry no role, tabIndex, or onKeyDown, so the directory picker cannot be operated or even focused by keyboard — only the per-row Arco 'Select' Button at :224 is reachable via Tab, and it cannot navigate into folders. (c) The title at :148 concatenates emoji outside the translation: `isFileMode ? '📄 ' + t('fileSelection.selectFile') : '📁 ' + t('fileSelection.selectDirectory')`, so translators cannot reposition or drop the glyph (it lands wrong in the fa-IR RTL locale). NOTE for finding #8: this file now uses AionModal (imported :13, used :144), not a raw Arco Modal as the older finding claimed.
- **Done when:** (a) Guard the list: when `!loading && !error && directoryData.items.length === 0`, render an Arco `<Empty description={t('fileSelection.emptyFolder')} />`; add that new key to fileSelection.json in all 12 locales (that file currently holds only 4 keys). Keep the go-up row visible in the empty case so the user can escape. (b) Give both the go-up row and each item row `role='button'`, `tabIndex={0}`, and an `onKeyDown` that fires the same handler on Enter and Space (with preventDefault on Space so the scroll container does not jump); the nested Select Button already stopPropagation's at :228 so it will not double-fire. (c) Move the glyph into the locale strings — either prepend it inside each fileSelection.selectFile / selectDirectory value, or drop it and render the existing IconFile/IconFolder next to the title; either way no string concatenation with an emoji literal remains in the TSX. Done when the picker is fully navigable with Tab + arrow-free Enter/Space, an empty dir shows copy, and grep finds no '📄'/'📁' in the file.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/conversation/Messages/components/ToolOutputCitations.tsx:47-49 (role='button' + tabIndex={0} on a non-button element) and packages/desktop/src/renderer/components/layout/Layout.tsx:351; for the empty state, packages/desktop/src/renderer/components/settings/SettingsModal/contents/channels/WecomConfigForm.tsx:583 — `<Empty description={t(...)} />`
- **Testing:** Mock the /api/fs/browse fetch to resolve { items: [], canGoUp: true } and assert the empty copy renders. For keyboard access, fireEvent.keyDown(row, { key: 'Enter' }) and assert loadDirectory was called — jsdom handles this since the rows are plain divs. This component fetches over HTTP rather than IPC, so stub global.fetch.

##### 5. McpServerToolsList returns null for a tool-less server, so expanding it shows an unexplained empty box

- **Status:** `HOLDS` — holds exactly as originally found
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/settings/ToolsSettings/McpServerToolsList.tsx:13`
  - `packages/desktop/src/renderer/pages/settings/ToolsSettings/McpServerToolsList.tsx:14`
  - `packages/desktop/src/renderer/pages/settings/ToolsSettings/McpServerItem.tsx:60`
- **Problem:** Holds at the exact cited lines. `if (!server.tools || server.tools.length === 0) { return null; }` at :13-15. The parent renders it unconditionally as the sole child of a Collapse.Item whose content box is force-padded — McpServerItem.tsx:58 sets `[&_div.arco-collapse-item-content-box]:py-3` and :60 renders `<McpServerToolsList server={server} />` — so returning null still leaves a visible padded gap. A connected server that genuinely exposes zero tools is therefore indistinguishable from a server whose tool list failed to load or has not been fetched yet. Reaches the user through TWO parents: the standalone Tools page (McpManagement.tsx:186, :202) and the settings-modal Tools tab (ToolsModalContent.tsx:236, :251).
- **Done when:** Replace the `return null` with an explicit empty state rather than nothing — a centred `text-t-secondary` line (or Arco `<Empty />`) reading a new settings.mcpNoTools key, e.g. "This server exposes no tools". There is no such key today: settings.json has mcpNoDescription (:779) but nothing for an empty tool list, so add settings.mcpNoTools across all 12 locales. Because `useTranslation` is already wired at :11, this is a two-line change plus locale files. Verify in BOTH render paths (Tools settings page and the settings-modal Tools tab) that expanding a tool-less server now shows copy instead of a bare padded box. Done when McpServerToolsList never returns null for a connected server and node scripts/check-i18n.js passes.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/components/settings/SettingsModal/contents/channels/WecomConfigForm.tsx:658 — `<Empty description={t('settings.assistant.noAuthorizedUsers', 'No authorized users yet')} />`, the in-repo empty-list idiom
- **Testing:** Render McpServerToolsList with server.tools = [] and with tools undefined; assert the empty copy renders and the container is non-empty. Trivial in jsdom — the component takes a single plain prop and needs no IPC.

##### 8. Two modal chromes still coexist: AionModal vs raw Arco Modal (refactor, not a bug)

- ⛔ **NEEDS A DECISION BEFORE STARTING — excluded from this stream's 8 actionable.**
  Its acceptance is "either migrate every site, or write the two-chrome rule
  down", which is a policy call, not an implementation. A solo session cannot
  settle it. Bring it back to whoever owns this doc and get an answer first;
  do not open it speculatively as part of Stream 5.
- **Status:** `PARTIALLY_FIXED` — partly fixed upstream — only the sites below remain
- **Effort:** large
- **Where:**
  - `packages/desktop/src/renderer/pages/settings/AssistantSettings/DeleteAssistantModal.tsx:26`
  - `packages/desktop/src/renderer/pages/settings/AssistantSettings/SkillConfirmModals.tsx:50`
  - `packages/desktop/src/renderer/pages/settings/AssistantSettings/SkillConfirmModals.tsx:84`
  - `packages/desktop/src/renderer/pages/settings/SkillsSettings/SkillsHubSettings.tsx:304`
  - `packages/desktop/src/renderer/pages/settings/SkillsSettings/SkillsHubSettings.tsx:861`
  - `packages/desktop/src/renderer/pages/settings/ToolsSettings/McpManagement.tsx:231`
  - `packages/desktop/src/renderer/components/settings/SettingsModal/contents/ToolsModalContent.tsx:282`
  - `packages/desktop/src/renderer/pages/conversation/projects/ProjectCreateModal.tsx:92`
- **Problem:** The split is real but the membership changed, so I re-derived it. DirectorySelectionModal is NO LONGER a raw-Modal offender — it migrated to AionModal (import at DirectorySelectionModal.tsx:13, used at :144), contradicting the original finding. Current AionModal adopters in scope (12): DirectorySelectionModal, FeedbackReportModal, WebuiModalContent, SettingsModal/index, AgentHubModal, LocalAgents, CssThemeModal, AddModelModal, AddPlatformModal, EditModeModal, JsonImportModal, OneClickImportModal. Current raw-Arco-Modal holdouts are the ones listed in locations: DeleteAssistantModal.tsx:26, SkillConfirmModals.tsx:50 and :84, SkillsHubSettings.tsx:304 and :861 (both Modal.confirm), McpManagement.tsx:231, ToolsModalContent.tsx:282, plus the cited ProjectCreateModal.tsx:92 (outside this stream's paths). The pattern is that full-form/multi-step dialogs have migrated to AionModal while short confirmation dialogs remain on raw Modal / Modal.confirm — which is arguably a reasonable line, since Modal.confirm has no AionModal equivalent. Consequence is cosmetic drift only: raw Modals miss AionModal's standard header/footer padding, divider and dialog-fill background.
- **Done when:** LARGE and OPTIONAL — do not undertake as part of a bugfix pass, and per AGENTS.md's no-scope-expansion rule do not let a review turn this into required cleanup. If the team does choose it: decide explicitly whether confirmation dialogs are in scope, because migrating the two Modal.confirm call sites (SkillsHubSettings.tsx:304, :861) requires either an imperative AionModal.confirm helper that does not exist yet or converting them to declarative visible-state components. A defensible smaller outcome is to formalise the current line — AionModal for form/multi-step dialogs, raw Modal for confirms — and instead standardise only what actually drifts: the danger-status and title/content i18n shape of the confirms (see the destructive-confirm finding). Done when either every listed site renders through AionModal, or the two-chrome rule is written down and each confirm matches it.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/components/settings/DirectorySelectionModal.tsx:144-158 — the most recent raw-Modal-to-AionModal migration in this stream, showing how variant/header/footer/wrapStyle/maskStyle map across
- **Testing:** Any migration must preserve the z-index stacking these modals rely on: DeleteAssistantModal.tsx:37-38 uses wrapStyle 10000 / maskStyle 9999 and DirectorySelectionModal.tsx:156-157 deliberately sits above at 10050 / 10040 because it opens from inside other modals. Also preserve data-testid hooks (DeleteAssistantModal.tsx:33 'modal-delete-assistant', SkillsHubSettings.tsx:870 wrapClassName 'modal-delete-skill') — existing DOM tests such as tests/unit/renderer/projects/ProjectCreateModal.dom.test.tsx select on these.

##### 9. Batch skill delete styled warning instead of danger; MCP delete confirm never names the server

- **Status:** `PARTIALLY_FIXED` — partly fixed upstream — only the sites below remain
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/pages/settings/SkillsSettings/SkillsHubSettings.tsx:310`
  - `packages/desktop/src/renderer/pages/settings/ToolsSettings/McpManagement.tsx:240`
  - `packages/desktop/src/renderer/components/settings/SettingsModal/contents/ToolsModalContent.tsx:291`
  - `packages/desktop/src/renderer/services/i18n/locales/en-US/settings.json:663`
- **Problem:** The red-styling half of this finding is already satisfied everywhere the finding named — DeleteAssistantModal.tsx:31 and McpManagement.tsx:236 both use okButtonProps status 'danger', as do SkillConfirmModals.tsx:54,:88 and SkillsHubSettings.tsx:867. But I found a site that DISAGREES with the settled rule: SkillsHubSettings.tsx:310, the BATCH delete confirm reached from handleBatchDelete, uses `okButtonProps: { status: 'warning' }` while calling ipcBridge.fs.deleteSkill for every selected skill at :316. Orange is reserved for non-destructive-but-consequential actions, and this permanently removes N skills — strictly more destructive than the single-skill delete at :867 which correctly uses 'danger'. The file contradicts itself. Separately, the naming defect holds and affects TWO copy-pasted sites, not one: McpManagement.tsx:240 and ToolsModalContent.tsx:291 both render `<p>{t('settings.mcpDeleteConfirm')}</p>`, and that string (settings.json:663) is "Are you sure you want to delete this MCP server?" — no interpolation, so the user cannot tell which server is about to go. Both files already hold the name: `serverToDelete` is typed `string | null` (useMcpModal.ts:12) and is in scope at McpManagement.tsx:131 and ToolsModalContent.tsx:113.
- **Done when:** Change SkillsHubSettings.tsx:310 from `status: 'warning'` to `status: 'danger'` so it matches :867. For the naming defect, change settings.mcpDeleteConfirm to interpolate a name — e.g. "Are you sure you want to delete \"{{name}}\"?" — updating the value in all 12 locale settings.json files, then pass `t('settings.mcpDeleteConfirm', { name: serverToDelete })` at BOTH McpManagement.tsx:240 and ToolsModalContent.tsx:291 (fixing only one leaves the settings-modal Tools tab unnamed). Optionally give the batch-skill confirm the same treatment; settings.skillsHub.batchDeleteConfirmContent already interpolates `count`. Done when grep shows no `status: 'warning'` on any delete confirm in pages/settings, both MCP confirms render the server name, and node scripts/check-i18n.js passes.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/settings/SkillsSettings/SkillsHubSettings.tsx:861-868 — danger status plus a name-interpolated content string, i.e. both halves done right, 550 lines below the offender in the same file; the string shape lives at packages/desktop/src/renderer/services/i18n/locales/en-US/settings.json:32 ("Are you sure you want to delete \"{{name}}\"?")
- **Testing:** For the batch confirm, assert the Modal.confirm spy receives okButtonProps.status === 'danger' — SkillsHubSettings already has delete testids (btn-delete-<name> at :857) and wrapClassName 'modal-delete-skill' to select on. For the MCP confirms, render each parent with deleteConfirmVisible true and serverToDelete set, then assert the server name appears in the dialog body; do it for both McpManagement and ToolsModalContent since they are separate components.

##### 10. Provider API keys render in unmasked inputs while Bedrock credentials in the same files use Input.Password

- ⚠️ **Split this in two and land the halves separately.** The
  `AddPlatformModal.tsx:553` half is a genuine one-line drop-in — do that first
  and independently. The `EditModeModal.tsx:236` half has no in-repo precedent
  (a masked multi-line control does not exist anywhere in this codebase), so you
  are designing a new control: keep it as plain as possible, and write the
  newline-round-trip regression test BEFORE touching the control, as the
  acceptance below instructs. If the reveal affordance starts growing, stop and
  ship only the AddPlatformModal half.

- **Status:** `HOLDS` — holds exactly as originally found
- **Effort:** medium
- **Where:**
  - `packages/desktop/src/renderer/pages/settings/components/AddPlatformModal.tsx:553`
  - `packages/desktop/src/renderer/pages/settings/components/EditModeModal.tsx:236`
- **Problem:** NEW finding — this is the surviving form of the void ApiKeyEditorModal issue, which I confirmed deleted (no ApiKeyEditorModal file exists; removed upstream in 826eba76c). Two surfaces still render a secret in the clear, and each is internally inconsistent with itself. AddPlatformModal.tsx:532-558 binds `field={'api_key'}` and renders a plain `<Input onBlur={...} />` at :553 — fully visible, shoulder-surfable, and captured by screen shares — while the SAME file masks the far less sensitive Bedrock credentials with `<Input.Password placeholder='AKIA...' visibilityToggle />` at :605 and `<Input.Password visibilityToggle />` at :616. EditModeModal.tsx repeats the pattern: `field={'api_key'}` at :233 renders `<Input.TextArea rows={4} placeholder={t('settings.apiKeyPlaceholder')} />` at :236 — a 4-row textarea showing every stored key in plaintext whenever a user opens platform edit — while :282 and :293 in that same file use Input.Password visibilityToggle for Bedrock. The EditModeModal case is the worse exposure because it displays already-saved keys, not just freshly typed ones.
- **Done when:** AddPlatformModal.tsx:553 is a clean drop-in: swap `<Input onBlur={...} />` for `<Input.Password visibilityToggle onBlur={...} />`, keeping the existing onBlur that triggers modelListState.mutate(). This is safe because at add time the field is single-key — settings.multiApiKeyTip (settings.json:374) explicitly says multiple keys are configured later in platform edit. EditModeModal.tsx:236 is NOT a drop-in and must not be blindly converted: it is deliberately multi-line because settings.multiApiKeyEditTip (settings.json:375) is "Support multiple API Keys, one per line, system will auto-rotate" and settings.apiKeyPlaceholder (:376) says "one per line for multiple keys", while Input.Password is single-line and would silently break newline-separated rotation. For that one, keep Input.TextArea but hide the value by default and add an explicit reveal affordance (an Arco Button toggling a masked read-only display against the real textarea), so the multi-key contract survives. Done when opening AddPlatformModal shows the API key masked with a working eye toggle, opening platform edit does not display stored keys until the user reveals them, newline-separated multi-key entry still round-trips, and no Arco `<Input`/`<Input.TextArea` in pages/settings is bound to field 'api_key' without a masking story.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/pages/settings/components/AddPlatformModal.tsx:605 and :616 — `<Input.Password ... visibilityToggle />` in the same file, the exact component and prop to adopt; packages/desktop/src/renderer/components/settings/SettingsModal/contents/SystemModalContent/VoiceInputSection/index.tsx:237 shows the controlled form, `<Input.Password value={activeApiKey} visibilityToggle onChange={...} />`
- **Testing:** Assert the rendered input has type='password' by default and flips to text after clicking the visibility toggle — Arco renders a real input so jsdom handles it. For EditModeModal, the load-bearing regression test is that a two-line api_key value submits both lines intact through Form onSubmit; write that before changing the control so you can prove multi-key rotation did not break.

##### 11. AionModal draws its header and footer dividers with --bg-3, making them invisible in dark mode on every modal in the app

- **Status:** `MOVED` — still true; the line numbers below are the re-verified ones
- **Effort:** small
- **Where:**
  - `packages/desktop/src/renderer/components/base/AionModal.tsx:392`
  - `packages/desktop/src/renderer/components/base/AionModal.tsx:120`
  - `packages/desktop/src/renderer/pages/settings/components/OneClickImportModal.tsx:308`
  - `packages/desktop/src/renderer/pages/settings/components/OneClickImportModal.tsx:350`
  - `packages/desktop/src/renderer/pages/settings/components/JsonImportModal.tsx:370`
- **Problem:** NEW finding — the documented dark-mode trap is present in the base modal itself, so it silently degrades every AionModal in the app. I verified this from the theme file rather than assuming: --bg-3 is #1e2536 in dark (styles/themes/default-color-scheme.css:112) and --dialog-fill-0 is ALSO #1e2536 (same file :158), and AionModal hardcodes its content background to `var(--dialog-fill-0)` (AionModal.tsx:216 `const contentBg = contentStyle?.background || 'var(--dialog-fill-0)'`, applied at :278). So the default-variant header rule at :392 `borderBottom: '1px solid var(--bg-3)'` and the footer rule at :120 `FOOTER_DIVIDER_CLASS = '... border-t border-solid border-[var(--bg-3)] ...'` paint #1e2536 on #1e2536 — the dividers simply do not exist in dark mode, collapsing the visual separation between title, body and action bar. Three in-scope callers repeat the same mistake against the same dialog fill: OneClickImportModal.tsx:308 and :350 draw the per-server row separators with `borderBottom: '1px solid var(--bg-3)'`, and JsonImportModal.tsx:370 outlines the CodeMirror editor with `'1px solid var(--bg-3)'` in its valid state (its invalid state correctly uses var(--danger), which is why only the valid state disappears).
- **Done when:** Replace --bg-3 with --bg-4 at all five sites, since --bg-4 is #2a3344 in dark (default-color-scheme.css:115) and #d8cbb6 in light (:31) and so stays visible against the #1e2536 dialog fill in both themes. Concretely: AionModal.tsx:392 becomes `borderBottom: '1px solid var(--bg-4)'`; AionModal.tsx:120's FOOTER_DIVIDER_CLASS uses `border-[var(--bg-4)]` (or the `border-4` utility); the three caller sites likewise move to var(--bg-4). Do NOT edit uno.config.ts or the theme files, and do not swap in a hex. Done when, with the app in dark mode, an AionModal shows a discernible rule under its title and above its footer buttons, the OneClickImport server rows show separators, the JSON editor shows a border in its valid state, and light mode is unchanged.
- **Copy this in-repo pattern:** packages/desktop/src/renderer/styles/themes/default-color-scheme.css:115 (--bg-4: #2a3344 dark) alongside :112 and :158 — the token evidence proving --bg-3 and --dialog-fill-0 collide in dark and that --bg-4 does not
- **Testing:** Not meaningfully testable in jsdom, which does not resolve CSS custom properties or compute cascaded colours. Verify visually: run the app, switch to dark mode, and open any AionModal plus the MCP one-click-import and JSON-import modals. Confirm light mode still looks right, since --bg-4 is a slightly stronger border there than --bg-3.

##### Void — verified fixed or gone; do not spend time here

- **#6. AddModelModal dead commented-out JSX and its orphaned computations** — `ALREADY_FIXED`. `packages/desktop/src/renderer/pages/settings/components/AddModelModal.tsx:1`
  - No longer reproducible at this tip. The file is 184 lines and contains no commented-out JSX block anywhere (the cited :100-118 is now live Select markup for the model picker). There is no `previewModels` and no `remainingCount` identifier in the file, and the imports the finding flagged as comment-only are gone: the Arco import at :10 is `{ Select }` alone and the icon import at :11 is `{ PreviewOpen }` — neither Button nor Tag is imported. The dead code was removed during the intervening ~30 commits.
- **#7. Fixed pixel modal heights in JsonImportModal and OneClickImportModal** — `ALREADY_FIXED`. `packages/desktop/src/renderer/pages/settings/components/JsonImportModal.tsx:333`, `packages/desktop/src/renderer/pages/settings/components/JsonImportModal.tsx:349`, `packages/desktop/src/renderer/pages/settings/components/OneClickImportModal.tsx:419`
  - The clipping risk described is gone. JsonImportModal no longer sets height 450 or 420-80; its AionModal takes only `style={{ width: 600 }}` at :333. OneClickImportModal no longer sets 560 or 560-96; its AionModal takes only `style={{ width: 680 }}` at :419 — `grep -n 'height' packages/desktop/src/renderer/pages/settings/components/OneClickImportModal.tsx` (the path operand is required — a bare `grep -n 'height'` reads stdin and hangs)` on that file returns zero hits. The single surviving fixed height is `height='300px'` on the CodeMirror editor at JsonImportModal.tsx:349, which is a code editor that scrolls internally and so does not clip content at large fontScale; that is defensible and should be left alone. The finding's cited comparison point is also void: AddModelModal sets no height or maxHeight at all now (no `90vh` anywhere in it), and JsonImportModal no longer contains any 'parity with AddModelModal' comment.

## Stream 0 decisions (DECIDED 2026-07-31 — apply as written)

- **Destructive-action styling: red for ALL deletes.** Any confirm that removes
  user data uses `status: 'danger'` / red. Ceremony scales with blast radius:
  `Modal.confirm` for containers (project, assistant, MCP server, team); inline
  `Popconfirm` is fine for single small items (one template card, one KB file)
  but must also be danger-styled. Orange/warning is reserved for
  non-destructive-but-consequential actions (e.g. stopping a running task).
  (Spans `useConversationActions.ts` S2; `ProjectChatList/ProjectHeader/
  ProjectKnowledgeCard` S4; `DeleteAssistantModal/McpManagement` S5 — each
  stream applies it to its own files.)
- **Template name/description i18n: localize built-ins.** Built-in template
  names + descriptions move to locale keys
  `conversation.presentationTemplates.catalog.<template-id>.name` /
  `.description` × 12 locales; the renderer resolves built-ins via `t()` and
  falls back to `manifest.name`/`manifest.description` for user-imported
  templates (source `user` — user content, can't be pre-translated). The
  manifest strings in `presentation-templates/index.ts` stay as the canonical
  English source. Owned by S1.
- **Modal chrome — Stream 5 #8 is ANSWERED: write the two-chrome rule down; do
  NOT migrate.** (Decided by the doc owner, 2026-07-31, on the question the
  producing session escalated.) The rule, now policy: **`AionModal` for
  form and multi-step dialogs; raw Arco `Modal` / `Modal.confirm` for short
  confirmation dialogs.** The existing split already follows this and is
  defensible — `Modal.confirm` has no `AionModal` equivalent, and the only cost
  of the split is cosmetic (confirms miss AionModal's header/footer padding,
  divider and dialog fill). Rationale for not migrating: it would require
  inventing an `AionModal.confirm` helper or converting the two `Modal.confirm`
  call sites to declarative components, while preserving z-index stacking (one
  nested modal deliberately sits at 10050/10040) and the `data-testid` /
  `wrapClassName` hooks existing DOM tests select on — all for no user-visible
  gain. **What Stream 5 SHOULD do instead:** state this rule in a comment at the
  top of `AionModal.tsx` so the next reader stops re-litigating it, and
  standardise only the confirms' real drift — danger status and
  name-interpolated copy — which finding #9 already covers. Migration stays
  possible later; nothing here forecloses it.
- **Dispatch order — STAGED, not parallel (decided 2026-07-31).** Run
  **5 → 4 → 3**, one stream at a time, smallest first.
  **Progress: 5 ✅ merged (!27) · 3 ✅ MR !29 open (ran ahead of 4; harmless,
  ownership is disjoint and S5 added no `conversation.json` keys) · 4 is the only
  one left.** S4 now rebases onto `sprint1` *after* !29 lands, and is the last
  stream that will touch `conversation.json` — S3's block (`emptyChat`) sits at
  the end of the file, so append there and grep for exactly-once as usual.
  Reasons it is not
  parallel: several findings per stream can only be accepted by eye in both
  themes and only one dev app runs at a time (a second needs
  `bun run start:multi`), and S3+S4 both add keys to `conversation.json` — the
  silent-duplicate-key landmine. Each stream rebases onto the newly-moved
  `origin/sprint1` when it starts, so line numbers must be re-derived for any
  file the previous stream touched (ownership is disjoint, so this should be
  nothing — verify, don't assume).

## Escalations

(append here: "S<N>: needs <file> owned by S<M> because <why>")

- **S3 status: ✅ MR !29 OPEN into `sprint1`, 2026-07-31**
  (branch `feat/ui-messages-composer`, 10 commits, rebased onto `759292eee`
  conflict-free). All 16 findings done. Gate via `just push`: 0 lint errors,
  format clean, tsc clean, i18n in sync, **516 files / 4689 tests passing**.
  `ShadowView.tsx` was used under the grant in re-verification item 1.
  - **Three findings were wrong as written** and are corrected in place above:
    **#15 is VOID (false positive)**, **#9 needed `!`-prefixed border utilities**,
    and **#6's cheapest option ships a regression**. Each passed lint, tsc and
    jsdom in its wrong form — this is the bug class the sweep exists to remove,
    and it is now three-for-three that only live measurement caught it.
  - **The `--bg-3` sweep for S3's files is complete.** After #15 turned out void,
    the only real border defect in this territory was #9's, now fixed. A full
    grep of S3-owned files returns no remaining `border-3`.
  - **KB citation click-through (MR !17) verified intact**, not just
    structurally: pressing Enter on a real citation opens the preview drawer.
    Findings 5/6/16 all touch that path and none broke it.
  - **i18n:** 4 new keys ×12 in one commit — `messages.permissionResponseFailed`,
    `messages.plan.title`, `conversation.chat.stopGenerating`,
    `conversation.emptyChat`. Both new parents (`messages.plan`,
    `conversation.emptyChat`) are appended at the END of their file, clear of
    S1's `presentationTemplates`, S4's `projectHome` and the KB hint's
    `staleKnowledgeHint`. **S4 is the last stream still to add
    `conversation.json` keys** — no collision with S3's block if it does the same.
  - **Not done, deliberately:** the en-US-only `messages.reasoning` /
    `messages.permission.*` blocks (9 keys short per locale) are untouched per
    the dispatcher ruling, and noted in one line in the MR.
  - **Two verification gaps, stated in the MR rather than glossed:** greeting +
    `KbStaleChatHint` could not be shown in one conversation (no project-scoped,
    knowledge-less, zero-message chat exists, and making one means editing local
    dev data) — measured separately and disjoint by construction; and
    `MessagePlan` / `MessageThinking` / both permission cards have no live check
    because the dev DB holds no such message types.

- ⚠️ **CORRECTED 2026-07-31 — the escalation below was mostly WRONG, and the way
  it was wrong is the lesson.** The symptom S3 measured (reasoning clipped at
  160px with no expand control) was **an artifact of a hidden dev window**, not a
  component bug: `CollapsibleContent`'s height check is gated behind
  `requestAnimationFrame`, and **rAF does not fire when the Electron window is
  hidden** — confirmed afterwards with `document.visibilityState === 'hidden'`
  and a probe callback that never ran. Mount-time detection is fine when the
  window is visible: a clamped box with 420px of content in a 160px clamp
  correctly reports `scrollHeight: 420`. **This trap was already recorded in
  project memory and still cost a wrong diagnosis — before concluding "this
  rAF-gated UI is broken", check `document.visibilityState` and confirm a probe
  rAF actually fires.**
  What survived scrutiny is much narrower and IS real: a `ResizeObserver` on the
  clamped box never fires on content growth (measured 420px → 2814px, **0**
  callbacks). But growth arriving with a React re-render was always handled,
  because `children` is in the effect's dep list. So the genuine gap is only
  growth with no re-render — images/fonts finishing, async children like Mermaid
  or KaTeX. **Fixed** on `fix/collapsible-content-grow` by observing an unclamped
  inner wrapper (same probe then reports 1 callback and the correct height).
  Finding 6's shipped header-toggle is still the right call on its own merits
  (it mirrors MessageThinking and gives a labelled control), but its stated
  justification was wrong.

  ~~**S3 → whoever owns `components/chat/CollapsibleContent.tsx` (cross-cutting,
  NOT fixed): it cannot bound content that grows after mount.**~~ The toggle is
  gated on `needsCollapse`, computed in an effect that reads
  `contentRef.current.scrollHeight` and observes that same element with a
  ResizeObserver (`:113-147`). But `contentRef` is the element carrying
  `max-height: <maxHeight>px; overflow: hidden` (`:184-190`), so its observed box
  is pinned and the observer never fires on content growth. Net effect for
  streamed or progressively-revealed children: the content is clipped behind the
  fade with **no way to expand it** — silently worse than not using the component
  at all. Reproduced live at `maxHeight: 160` with a 291px body. Existing call
  sites are safe only because their content is complete at mount (the JSON branch
  at `MessageText.tsx`). S3 worked around it locally rather than fix it, since
  the file belongs to no stream. A real fix means measuring an *inner* wrapper
  that is not height-constrained, or observing the children rather than the
  clipped box.

- **S5 status: ✅ MERGED — MR !27 into `sprint1`, 2026-07-31 18:19**
  (merge commit `759292eee`, branch tip `e2a0bba40`, 13 commits, source branch
  deleted). All 8 actionable findings, plus #8 answered as documentation per
  Stream 0, plus two extras. **Streams 4 and 3 should rebase onto
  `sprint1@759292eee` before starting**, and re-run `bun run i18n:types` after
  any locale merge — S5 rewrote `i18n-keys.d.ts`.
  S5 touched two files owned by no stream, now in `sprint1`:
  `components/layout/Titlebar/index.tsx` (its sidebar/workspace tooltips used
  `t('common.expandMore', { defaultValue: … })` — the key exists, so the
  defaultValue was dead and the button announced a bare verb) and a comment in
  `pages/team/components/TeamCreateModal.tsx`.
  - **Its `--bg-3` sweep is complete and the survivors must NOT be "fixed".**
    The remaining `--bg-3` hairlines in S5 territory sit on non-dialog surfaces
    where the token reads fine in dark: `WorkspacePanelHeader.tsx:37`
    (`border-b border-[var(--bg-3)]` on a `bg-1` panel — delta 30) and
    `ChatLayout/index.tsx:278,306` (`borderLeft` on the page shell,
    `--bg-chat-surface` = `--bg-base` = `#0b0e14` — delta ~45). Only the
    `--dialog-fill-0` cases were delta **0**, and those are the ones S5 fixed.
    Confirms the rule: check the surface before changing a hairline.
  - **S5 added no keys to `conversation.json`** — verified zero touches — so it
    cannot collide with S3/S4 on the silent-duplicate-key landmine. Its blocks:
    one new `common.chrome` (7 keys), 4 flat `settings.*`, 2 `fileSelection.*`,
    all ×12. No other unmerged branch touches those four files.
  - ⚠️ **Two spawned side-tasks branched off S5 mid-stream and inherit its
    commits**, so S5 must land first or their MRs will carry S5's work:
    `fix/skills-hub-card-borders` (sitting at S5's 8th commit, so it lacks the
    `fileSelection.*` keys — if it regenerates `i18n-keys.d.ts` from that base it
    will DROP them; re-run `bun run i18n:types` after any merge) and
    `claude/funny-yalow-69a185`, which holds a **pre-amend copy of S5's e2e commit
    still carrying a forbidden `Co-Authored-By` trailer** — do not push that
    branch; the amended commit is on `feat/ui-settings-chrome`.

- **S1 → design system (cross-cutting, NOT fixed): `--bg-3` is unusable as a
  border in dark mode.** `--bg-3` is commented as the border/divider token
  (`themes/default-color-scheme.css:28,112`) but in dark it resolves to
  `#1e2536` — byte-identical to `--dialog-fill-0` (`:158`), which it also serves
  as "cards / raised surface". Any hairline drawn with `border-3` on a dialog or
  card surface is therefore invisible in dark mode. S1 worked around it locally
  by bordering with `border-4` (`--bg-4`, `#2a3344` dark / `#d8cbb6` light) —
  the only step that reads against both surfaces. Other streams fixing dark-mode
  borders should use `border-4` on raised surfaces too, and NOT "fix" `--bg-3`
  in `uno.config.ts` / the theme file (frozen for streams; a real fix means
  splitting the surface and border roles apart, which is its own change).
- **S1 note for whoever owns `process/services/dashboard-store/`:**
  `bun run lint:fix` autofixes `.sort()` → `.toSorted()` in
  `DashboardStoreService.test.ts:60`. It is pre-existing drift, unrelated to any
  stream; S1 reverted it rather than land it. Expect it to reappear on every
  `lint:fix` until someone owning that file commits it.
  (Confirmed again 2026-07-31 by the KB stale-chat-hint branch, which also
  reverted it.)
- **NOT a UI stream, but it touches S3's files — KB stale-chat hint**
  (branch `feat/kb-stale-chat-hint`, off `sprint1@d60397537`, unpushed).
  A dismissible Arco `Alert` between the message list and the composer telling
  the user their chat cannot search the project knowledge base. It edits three
  files nominally owned by S3, each minimally, and no S3 branch existed at the
  time:
  - `components/ChatConversation.tsx` — two more `extra` casts passed down,
    mirroring the existing `loadedMcpStatuses` line.
  - `platforms/acp/AcpChat.tsx`, `platforms/aionrs/AionrsChat.tsx` — accept
    `project_id` + `session_mcp_servers`, render `<KbStaleChatHint/>` before the
    send box (ACP's is inside the existing `!hideSendBox` block, now wrapped in
    a fragment).
  `pages/conversation/index.tsx` and `SendBox/index.tsx` are NOT touched. New
  code lives in `pages/conversation/knowledge/` (S3 does not own it).
  **i18n:** its own new top-level `conversation.staleKnowledgeHint` block
  (`body`, `changedBody`, `action`) appended at the END of each
  `conversation.json` ×12 — deliberately clear of S4's `projectHome` block and
  of every other stream's block, so a text-merge cannot silently duplicate it.
- **Finding for anyone touching project chats: a conversation's MCP server set
  is frozen at creation, and the knowledge subprocess is frozen at spawn.**
  `extra.session_mcp_servers` is written once by aioncore at create, so a chat
  started before a project had indexed files never gets
  `aionui-project-knowledge` and never will. Separately — verified live
  2026-07-31 — even a chat that HAS the server cannot see files indexed after
  its session spawned: in one turn the same session found a file indexed before
  it started and returned "No relevant passages found" for an exact-name query
  on one indexed after, while a fresh chat found it immediately. Don't design
  KB features assuming an open chat picks up new files.
- **`BUILTIN_KNOWLEDGE_NAME` moved to `@/common/knowledge/constants`** (from
  `process/resources/builtinMcp/constants.ts`) so the renderer can match against
  it without violating the process boundary. The process file keeps
  `BUILTIN_KNOWLEDGE_ID`/`_SCRIPT` and stays import-free; the two process
  consumers now import from `common/`. If you need the name in renderer code,
  import it from `common/` — do not re-inline the literal.
