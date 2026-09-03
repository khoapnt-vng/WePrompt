# BUG-016 Grouped Thinking Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Kimi thinking activity visible when `thinking.subject` is missing or unsafe, while making reasoning detail opt-in and preserving the current disclosure boundary.

**Architecture:** Extend the pure journal-row builder with thinking-specific localized fallbacks, then include thinking records in the existing collapsed Technical Details surface without using their content as public narration. Subject sanitization remains the only source of an automatic label.

**Tech Stack:** React, strict TypeScript, Vitest 4, Arco UI, i18next.

## Global Constraints

- Do not display `message.content.content` as a fallback label, tooltip, accessibility name, log entry, or automatic preview.
- Keep `getSafeProviderNarration` as the subject safety boundary. Null, blank, diagnostic, path-like, command-like, or otherwise unsafe subjects use localized fallback text.
- Reasoning detail is visible only after the user activates the existing disclosure control; completed detail remains collapsed by default.
- Preserve BUG-005 behavior: completed execution journals stay concise and Technical Details remains opt-in.
- Add/modify keys in all 12 `messages.json` locale modules and regenerate i18n types.

---

### Task 1: Add the localized grouped-thinking fallback

**Files:**

- Modify: `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx`
- Modify: `tests/unit/chat/MessageToolGroupSummary.dom.test.tsx`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/messages.json`
- Regenerate: `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts`

**Interface:**

```ts
type JournalFallbacks = {
  plan: { running: string; done: string };
  thinking: { running: string; done: string };
};

buildJournalRows(messages, fallbacks)
```

Add keys:

- `messages.toolActivity.thinking.running`: `Thinking…`
- `messages.toolActivity.thinking.done`: `Thought complete`

- [ ] Write failing DOM tests for live and persisted thinking records with `subject: null`, whitespace-only, safe natural-language, unsafe shell/path/telemetry text, and completed status.
- [ ] Include a unique raw-reasoning sentinel in `content` and assert it is absent from the row text, DOM, accessible names, and tooltip content before disclosure.
- [ ] Change `buildJournalRows` so every thinking record produces a narration row: safe subject when available, otherwise `thinking.running`/`thinking.done` according to status.
- [ ] Carry `fallbackDoneLabel` so an active missing-subject row changes from `Thinking…` to `Thought complete` when settled.
- [ ] Keep adjacent fallback collapse behavior and ensure thinking fallback is not mislabeled with generic plan copy.
- [ ] Run:

```bash
bunx vitest run tests/unit/chat/MessageToolGroupSummary.dom.test.tsx
bun run i18n:types
node scripts/check-i18n.js
bun run test
```

- [ ] Commit `fix(conversation): show grouped thinking fallback`.

### Task 2: Preserve opt-in reasoning disclosure through grouping

**Files:**

- Modify: `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx`
- Modify if needed for an explicit collapsed default: `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageThinking.tsx`
- Modify: `tests/unit/chat/MessageToolGroupSummary.dom.test.tsx`
- Modify: `tests/unit/renderer/messageThinking.dom.test.tsx`

- [ ] Write a failing test proving grouped thinking content remains absent initially, remains absent when only the concise status row is activated, and becomes reachable only after the user expands Technical Details and then the reasoning disclosure.
- [ ] Add keyboard tests for Enter/Space activation, `aria-expanded`, `aria-controls`, focus retention, and completed-turn collapse.
- [ ] Add live-record coverage: content must not appear merely because a streaming record arrives. If Technical Details was not explicitly opened, no content node is rendered.
- [ ] Render grouped thinking records through the existing `MessageThinking` disclosure semantics inside Technical Details; do not create a second raw `<pre>` path or copy the content into `JournalRow`.
- [ ] Keep unsafe/missing subjects on the localized public fallback even when content exists. Disclosure never changes the public label.
- [ ] Prove grouping preserves the original thinking message/content object without mutation and ungrouped rendering remains unchanged.
- [ ] Run:

```bash
bunx vitest run tests/unit/chat/MessageToolGroupSummary.dom.test.tsx tests/unit/renderer/messageThinking.dom.test.tsx
bun run i18n:types
node scripts/check-i18n.js
just check
bun run test
bun run test:coverage
```

- [ ] Commit `fix(conversation): retain grouped thinking disclosure`.

## Final Acceptance

- Missing, blank, and unsafe subjects produce localized running/completed rows.
- Safe subjects remain visible and bounded by the current narration sanitizer.
- Raw thinking content never becomes automatic narration or accessibility copy.
- Grouped detail is available only through explicit disclosure and works by keyboard.
- Persisted/live, grouped/ungrouped, running/completed, and redaction cases pass in all locales.

