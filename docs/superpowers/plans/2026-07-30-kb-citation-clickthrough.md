# KB Citation Click-through Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make knowledge-base citations clickable in both the assistant's answer text and the `search_project_knowledge` tool-result block, opening the existing `KnowledgeSourcePreview` drawer scrolled to the cited section.

**Architecture:** A conversation-level `KnowledgeCitationsProvider` (mounted in `ChatConversation`) caches the project's source list, exposes a memoized markdown linkifier + an `openCitation` handler, and owns the preview drawer. Recognition is exact-match against known source fileNames (prose) or the tool's own citation-line format (tool block, via a new Node-free `common/knowledge/citationFormat.ts` shared with `searchCore`). Links use a custom `weprompt-kb://open?file=…&anchor=…` scheme intercepted inside `MarkdownView` before any external-URL handling.

**Tech Stack:** React 18 + Arco, react-markdown (shadow DOM via ShadowView), vitest (node + jsdom projects), i18next (12 locales).

**Branch:** `feat/kb-citation-clickthrough` off `origin/sprint1` (already created).

**Repo facts discovered (do not re-derive):**
- Monorepo: all app code under `packages/desktop/src/`. Tests live in `tests/unit/**` (node: `*.test.ts`, jsdom: `*.dom.test.ts(x)`), setup files `tests/vitest.setup.ts` / `tests/vitest.dom.setup.ts`.
- `formatHitsAsText` (`common/knowledge/searchCore.ts:111`) builds header lines inline: `` `[${i + 1}] ${hit.sourceName} — ${hit.headingPath}` `` (em dash U+2014, spaces) or without the suffix when `headingPath` is falsy. Sole caller of the output: `process/resources/builtinMcp/knowledgeServer.ts:130`.
- `headingPath` is a ` > `-joined trail (`"HR > Visa"`); PDF chunks use `Page 3` / `Pages 1–3` (en dash U+2013) and the extracted text has `## Page N` headings (`common/knowledge/pdfExtract.ts:150-174`).
- `MarkdownView` (`renderer/components/Markdown/index.tsx`): `handleLinkClick` sends every href to `openExternalUrl`; `urlTransform` uses react-markdown's `defaultUrlTransform` which STRIPS unknown schemes — `weprompt-kb:` must be whitelisted there or hrefs render empty. `onRef` exposes the `.markdown-shadow-body` div INSIDE the shadow root (mode: 'open'). `resolveLocalFileLinkReference` returns null for `weprompt-kb://…` (verified against its path heuristics), so the LocalFileLink branch won't hijack it.
- `remarkLocalFilePaths` never rewrites inside links/fenced code, and bare extensions-only names (`hop-dong.pdf`) do NOT match its local-path heuristics — no interference either direction.
- Assistant text renders in `MessageText.tsx`: final markdown string passed to `MarkdownView` is `shouldRevealStream || isRevealing ? displayedText : data` (line ~400). User messages render plain text (skip).
- The search tool result renders in `MessageToolGroupSummary.tsx` → `ToolItemDetail` → `<pre className='tool-detail-content'>{displayItem.output}</pre>` (line ~392). `NormalizedToolCall.output` for `acp_tool_call` is the joined text-content items (`common/chat/normalizeToolCall.ts:177-198`) — i.e. the verbatim `formatHitsAsText` string. `NormalizedToolCall.name` = the acp update *title*. Left-positioned acp_tool_calls are folded into `work_summary` items by `MessageList.tsx:395`; `MessageAcpToolCall.tsx` is the legacy/non-left path (out of scope).
- IPC (all existing, zero new channels): `ipcBridge.projectKnowledge.listSources.invoke({projectId})` → `{sources: IKnowledgeSourceDto[], summary, folderMissing}`; `getSourceText.invoke({projectId, sourceId})` → `{text, truncated}`; `updated.on(payload => payload.projectId)` emitter; `ipcBridge.shell.openFile.invoke(path)`.
- Project identity: `conversation.extra.project_id` (see `projectConversation.ts:16`), workspace: `conversation.extra.workspace`. Knowledge folder: `` `${workspace}/${KNOWLEDGE_FOLDER_NAME}/${fileName}` `` with `KNOWLEDGE_FOLDER_NAME = 'Knowledge Base'` from `common/knowledge/constants.ts`.
- `ChatConversation.tsx` has TWO return paths that must both be wrapped: the `aionrs` early return (line ~340) and the main `<ChatLayout>` return (line ~368).
- `KnowledgeSourcePreview.tsx` is pure-props `{fileName, text, truncated, loading, failed, onClose, onOpenOriginal}`; content renders through `MarkdownView`.
- i18n: per-namespace JSON per locale at `renderer/services/i18n/locales/<locale>/conversation.json`; knowledge keys live under `projectHome`. 12 locales: de-DE, en-US, es-ES, fa-IR, ja-JP, ko-KR, pt-BR, ru-RU, tr-TR, uk-UA, zh-CN, zh-TW. After adding keys: `bun run i18n:types` + `node scripts/check-i18n.js`.
- Root tsconfig: `noImplicitAny` only (NOT strict). Lint baseline ~847 warnings / 0 errors (`bun run lint:fix` = `oxlint --fix`). Format: scoped `bunx oxfmt <files>` only.
- dom-test conventions: see `tests/unit/chat/MessageToolGroupSummary.dom.test.tsx` (mock `react-i18next` with key-echo, partial-mock arco `Message`, testing-library).

---

### Task 1: `citationFormat.ts` — shared citation contract + searchCore swap

**Files:**
- Create: `packages/desktop/src/common/knowledge/citationFormat.ts`
- Modify: `packages/desktop/src/common/knowledge/searchCore.ts:123-126`
- Test: `tests/unit/knowledge/citationFormat.test.ts`

- [ ] **Step 1.1: Write the failing test**

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildCitationHeader,
  buildKbCitationHref,
  isKbCitationHref,
  parseCitationHeader,
  parseKbCitationHref,
  resolveAnchorHeadingText,
} from '@/common/knowledge/citationFormat';
import { formatHitsAsText } from '@/common/knowledge/searchCore';
import type { KnowledgeHit } from '@/common/knowledge/types';

describe('buildCitationHeader / parseCitationHeader round-trip', () => {
  it('round-trips a header with a heading path', () => {
    const line = buildCitationHeader(1, 'hop-dong-ctv-scan.pdf', 'Pages 1–3');
    expect(line).toBe('[1] hop-dong-ctv-scan.pdf — Pages 1–3');
    expect(parseCitationHeader(line)).toEqual({ ordinal: 1, fileName: 'hop-dong-ctv-scan.pdf', headingPath: 'Pages 1–3' });
  });

  it('round-trips a header without a heading path', () => {
    const line = buildCitationHeader(2, 'hr.md');
    expect(line).toBe('[2] hr.md');
    expect(parseCitationHeader(line)).toEqual({ ordinal: 2, fileName: 'hr.md' });
  });

  it('disambiguates fileNames containing the separator via the known set', () => {
    const name = 'Report — Final.pdf';
    const line = buildCitationHeader(3, name, 'Summary — 2026');
    expect(parseCitationHeader(line, [name])).toEqual({ ordinal: 3, fileName: name, headingPath: 'Summary — 2026' });
    // Without the known set it falls back to first-separator split (still non-null).
    expect(parseCitationHeader(line)?.fileName).toBe('Report');
  });

  it('rejects non-citation lines', () => {
    expect(parseCitationHeader('Found 2 passage(s) in the project knowledge base for "x":')).toBeNull();
    expect(parseCitationHeader('plain text')).toBeNull();
    expect(parseCitationHeader('')).toBeNull();
  });
});

describe('formatHitsAsText byte-identical fixture', () => {
  // This literal is the CONTRACT. If it fails, either searchCore's output or the
  // builder drifted — both ends must stay in sync with this fixture.
  it('produces exactly the historical output', () => {
    const hits: KnowledgeHit[] = [
      { sourceId: 's1', sourceName: 'hr.md', chunkIndex: 0, text: 'visa letter process', score: 1, headingPath: 'HR > Visa' },
      { sourceId: 's2', sourceName: 'hop-dong-ctv-scan.pdf', chunkIndex: 1, text: 'dieu khoan hop dong', score: 0.5, headingPath: 'Pages 1–3' },
      { sourceId: 's3', sourceName: 'notes.txt', chunkIndex: 0, text: 'no heading here', score: 0.2 },
    ];
    const expected =
      'Found 3 passage(s) in the project knowledge base for "visa":' +
      '\n\n[1] hr.md — HR > Visa\nvisa letter process' +
      '\n\n[2] hop-dong-ctv-scan.pdf — Pages 1–3\ndieu khoan hop dong' +
      '\n\n[3] notes.txt\nno heading here';
    expect(formatHitsAsText('visa', hits)).toBe(expected);
  });

  it('every header line in formatHitsAsText output parses back to its hit', () => {
    const hits: KnowledgeHit[] = [
      { sourceId: 's1', sourceName: 'hr.md', chunkIndex: 0, text: 'body a', score: 1, headingPath: 'HR > Visa' },
      { sourceId: 's2', sourceName: 'notes.txt', chunkIndex: 0, text: 'body b', score: 0.2 },
    ];
    const lines = formatHitsAsText('q', hits).split('\n');
    const parsed = lines.map((line) => parseCitationHeader(line, ['hr.md', 'notes.txt'])).filter(Boolean);
    expect(parsed).toEqual([
      { ordinal: 1, fileName: 'hr.md', headingPath: 'HR > Visa' },
      { ordinal: 2, fileName: 'notes.txt' },
    ]);
  });
});

describe('kb citation href helpers', () => {
  it('builds and parses an href without anchor', () => {
    const href = buildKbCitationHref('hop-dong.pdf');
    expect(isKbCitationHref(href)).toBe(true);
    expect(parseKbCitationHref(href)).toEqual({ fileName: 'hop-dong.pdf' });
  });

  it('round-trips names and anchors needing encoding', () => {
    const href = buildKbCitationHref('báo cáo (final) + notes.pdf', 'HR > Visa & Travel');
    expect(parseKbCitationHref(href)).toEqual({ fileName: 'báo cáo (final) + notes.pdf', anchor: 'HR > Visa & Travel' });
  });

  it('rejects foreign hrefs', () => {
    expect(parseKbCitationHref('https://example.com/?file=x.pdf')).toBeNull();
    expect(isKbCitationHref('file:///tmp/x.pdf')).toBe(false);
    expect(parseKbCitationHref('weprompt-kb://open')).toBeNull();
  });
});

describe('resolveAnchorHeadingText', () => {
  it('takes the most specific segment of a heading trail', () => {
    expect(resolveAnchorHeadingText('HR > Visa letters')).toBe('Visa letters');
    expect(resolveAnchorHeadingText('Single')).toBe('Single');
  });

  it('maps page ranges to their first page heading', () => {
    expect(resolveAnchorHeadingText('Pages 1–3')).toBe('Page 1');
    expect(resolveAnchorHeadingText('Pages 2-4')).toBe('Page 2'); // hyphen fallback
    expect(resolveAnchorHeadingText('Page 3')).toBe('Page 3');
    expect(resolveAnchorHeadingText('Docs > Pages 5–6')).toBe('Page 5');
  });

  it('returns empty string for blank anchors', () => {
    expect(resolveAnchorHeadingText('')).toBe('');
    expect(resolveAnchorHeadingText('  >  ')).toBe('');
  });
});
```

- [ ] **Step 1.2: Run it — expect FAIL (module not found)**

Run: `bun run test -- tests/unit/knowledge/citationFormat.test.ts`
Expected: FAIL — cannot resolve `@/common/knowledge/citationFormat`.

- [ ] **Step 1.3: Implement `citationFormat.ts`**

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// The citation-line contract between the knowledge search tool's text output
// (searchCore.formatHitsAsText, Node side) and the renderer's citation
// click-through. Node-free on purpose: the renderer imports the parser from
// here and must never pull searchCore (which drags in node:fs via store.ts).

export type ParsedCitationHeader = { ordinal: number; fileName: string; headingPath?: string };

const HEADER_PATTERN = /^\[(\d+)\] (\S.*)$/;
const SEPARATOR = ' — ';

export const buildCitationHeader = (ordinal: number, fileName: string, headingPath?: string): string =>
  headingPath ? `[${ordinal}] ${fileName}${SEPARATOR}${headingPath}` : `[${ordinal}] ${fileName}`;

/**
 * Parse one `[n] fileName — headingPath` line. Both the fileName and the
 * headingPath may legitimately contain the separator, so when the caller
 * knows the project's source names, the longest known name wins; otherwise
 * the first separator splits.
 */
export const parseCitationHeader = (line: string, knownFileNames?: readonly string[]): ParsedCitationHeader | null => {
  const match = HEADER_PATTERN.exec(line);
  if (!match) return null;
  const ordinal = Number(match[1]);
  const remainder = match[2];
  if (knownFileNames) {
    let best: string | null = null;
    for (const name of knownFileNames) {
      if (!name || (best && name.length <= best.length)) continue;
      if (remainder === name || remainder.startsWith(name + SEPARATOR)) best = name;
    }
    if (best) {
      const rest = remainder.slice(best.length);
      return rest ? { ordinal, fileName: best, headingPath: rest.slice(SEPARATOR.length) } : { ordinal, fileName: best };
    }
  }
  const separatorIndex = remainder.indexOf(SEPARATOR);
  if (separatorIndex === -1) return { ordinal, fileName: remainder };
  return {
    ordinal,
    fileName: remainder.slice(0, separatorIndex),
    headingPath: remainder.slice(separatorIndex + SEPARATOR.length),
  };
};

// --- click-through hrefs -----------------------------------------------------

// Custom scheme for citation links injected into chat markdown. MarkdownView
// intercepts it before any external-URL handling; it must never reach
// openExternalUrl.
const KB_CITATION_PREFIX = 'weprompt-kb://open';

export const isKbCitationHref = (href: string): boolean => href.startsWith(KB_CITATION_PREFIX);

export const buildKbCitationHref = (fileName: string, anchor?: string): string => {
  const query = anchor
    ? `file=${encodeURIComponent(fileName)}&anchor=${encodeURIComponent(anchor)}`
    : `file=${encodeURIComponent(fileName)}`;
  return `${KB_CITATION_PREFIX}?${query}`;
};

export const parseKbCitationHref = (href: string): { fileName: string; anchor?: string } | null => {
  if (!isKbCitationHref(href)) return null;
  const queryIndex = href.indexOf('?');
  if (queryIndex === -1) return null;
  const params = new URLSearchParams(href.slice(queryIndex + 1));
  const fileName = params.get('file');
  if (!fileName) return null;
  const anchor = params.get('anchor');
  return anchor ? { fileName, anchor } : { fileName };
};

// --- anchor → preview heading -------------------------------------------------

// PDF chunk anchors look like `Page 3` / `Pages 1–3` while the extracted text
// has one `## Page N` heading per page (see pdfExtract.ts) — a range points at
// its first page. Everything else scrolls to the trail's most specific segment.
const PAGE_RANGE_PATTERN = /^Pages?\s+(\d+)(?:\s*[–-]\s*\d+)?$/;

export const resolveAnchorHeadingText = (anchor: string): string => {
  const segments = anchor
    .split(' > ')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const target = segments.length > 0 ? segments[segments.length - 1] : '';
  const pageMatch = PAGE_RANGE_PATTERN.exec(target);
  return pageMatch ? `Page ${pageMatch[1]}` : target;
};
```

- [ ] **Step 1.4: Swap searchCore to the builder**

In `searchCore.ts`, add import and replace the inline header (keep everything else byte-identical):

```ts
import { buildCitationHeader } from './citationFormat';
```

Replace lines 124-126:

```ts
    const header = hit.headingPath
      ? `[${i + 1}] ${hit.sourceName} — ${hit.headingPath}`
      : `[${i + 1}] ${hit.sourceName}`;
```

with:

```ts
    const header = buildCitationHeader(i + 1, hit.sourceName, hit.headingPath);
```

- [ ] **Step 1.5: Run tests — expect PASS (incl. existing searchCore tests)**

Run: `bun run test -- tests/unit/knowledge/citationFormat.test.ts tests/unit/knowledge/searchCore.test.ts`
Expected: PASS.

- [ ] **Step 1.6: Commit**

```bash
git add packages/desktop/src/common/knowledge/citationFormat.ts packages/desktop/src/common/knowledge/searchCore.ts tests/unit/knowledge/citationFormat.test.ts
git commit -m "feat(knowledge): extract the citation header contract into a shared format module"
```

---

### Task 2: `linkifyKnownSources.ts` — pure markdown transform

**Files:**
- Create: `packages/desktop/src/renderer/utils/chat/linkifyKnownSources.ts`
- Test: `tests/unit/knowledge/linkifyKnownSources.test.ts`

- [ ] **Step 2.1: Write the failing test**

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildKbCitationHref } from '@/common/knowledge/citationFormat';
import { buildSourceLinkifier } from '@renderer/utils/chat/linkifyKnownSources';

const HREF = buildKbCitationHref('hop-dong.pdf');

describe('buildSourceLinkifier', () => {
  it('wraps a plain occurrence as a kb link', () => {
    const linkify = buildSourceLinkifier(['hop-dong.pdf']);
    expect(linkify('Nguồn: hop-dong.pdf nhé.')).toBe(`Nguồn: [hop-dong.pdf](${HREF}) nhé.`);
  });

  it('wraps a backticked occurrence keeping the code span as link text', () => {
    const linkify = buildSourceLinkifier(['hop-dong.pdf']);
    expect(linkify('File nguồn: `hop-dong.pdf`.')).toBe(`File nguồn: [\`hop-dong.pdf\`](${HREF}).`);
  });

  it('leaves a code span that is not exactly a fileName untouched', () => {
    const linkify = buildSourceLinkifier(['hop-dong.pdf']);
    expect(linkify('run `cat hop-dong.pdf` now')).toBe('run `cat hop-dong.pdf` now');
  });

  it('skips occurrences already inside a markdown link', () => {
    const linkify = buildSourceLinkifier(['hop-dong.pdf']);
    const already = `see [hop-dong.pdf](${HREF}) and [x](https://e.com/hop-dong.pdf)`;
    expect(linkify(already)).toBe(already);
  });

  it('skips occurrences inside fenced code blocks, including unclosed ones', () => {
    const linkify = buildSourceLinkifier(['hop-dong.pdf']);
    const fenced = 'a\n```\nhop-dong.pdf\n```\nb';
    expect(linkify(fenced)).toBe(fenced);
    const unclosed = 'a\n```\nhop-dong.pdf\n';
    expect(linkify(unclosed)).toBe(unclosed);
  });

  it('handles several files and regex metacharacters in names', () => {
    const weird = 'báo cáo (final) + notes.pdf';
    const linkify = buildSourceLinkifier(['hop-dong.pdf', weird]);
    const out = linkify(`x ${weird} y hop-dong.pdf z`);
    expect(out).toBe(`x [${weird}](${buildKbCitationHref(weird)}) y [hop-dong.pdf](${HREF}) z`);
  });

  it('does not match inside longer file-ish tokens', () => {
    const linkify = buildSourceLinkifier(['report.pdf']);
    expect(linkify('annual-report.pdf report.pdf.bak my.report.pdf')).toBe('annual-report.pdf report.pdf.bak my.report.pdf');
    expect(linkify('see report.pdf.')).toBe(`see [report.pdf](${buildKbCitationHref('report.pdf')}).`);
  });

  it('does not corrupt bare URLs containing a source name', () => {
    const linkify = buildSourceLinkifier(['hop-dong.pdf']);
    expect(linkify('https://x.com/hop-dong.pdf')).toBe('https://x.com/hop-dong.pdf');
  });

  it('is idempotent', () => {
    const linkify = buildSourceLinkifier(['hop-dong.pdf']);
    const once = linkify('plain hop-dong.pdf and `hop-dong.pdf`');
    expect(linkify(once)).toBe(once);
  });

  it('is the identity for an empty source list', () => {
    const linkify = buildSourceLinkifier([]);
    const text = 'anything hop-dong.pdf at all';
    expect(linkify(text)).toBe(text);
  });
});
```

- [ ] **Step 2.2: Run it — expect FAIL**

Run: `bun run test -- tests/unit/knowledge/linkifyKnownSources.test.ts`

- [ ] **Step 2.3: Implement**

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildKbCitationHref } from '@/common/knowledge/citationFormat';

// Pre-processes assistant markdown BEFORE MarkdownView renders it: every plain
// or backticked occurrence of a known knowledge-source fileName becomes a
// `weprompt-kb://` link. Pure string → string, idempotent, and deliberately
// blind to model prose — only exact known names ever match.

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One scan pattern, ordered so protected constructs win over name matches at
 * the same position:
 *  1. fenced code blocks — an unclosed fence (mid-stream) protects to the end
 *  2. existing markdown links/images (also protects our own injected links → idempotence)
 *  3. inline code spans (`` ``x`` `` then `` `x` ``) — handled specially below
 *  4. a known fileName, guarded so it never matches inside a longer token,
 *     another extension (`report.pdf.bak`) or a URL/path segment.
 */
const buildScanPattern = (namesAlternation: string): RegExp =>
  new RegExp(
    [
      '(```|~~~)[\\s\\S]*?(?:\\1|$)',
      '!?\\[[^\\]\\n]*\\]\\([^)\\n]*\\)',
      '``[^`\\n]+``',
      '`[^`\\n]+`',
      `(?<![\\w./=-])(${namesAlternation})(?![\\w-]|\\.[A-Za-z0-9])`,
    ].join('|'),
    'g'
  );

const INLINE_CODE_SPAN = /^(`{1,2})([^`\n]+)\1$/;

export const buildSourceLinkifier = (fileNames: readonly string[]): ((markdown: string) => string) => {
  const names = [...new Set(fileNames.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (names.length === 0) return (markdown) => markdown;
  const nameSet = new Set(names);
  const pattern = buildScanPattern(names.map(escapeRegExp).join('|'));
  return (markdown) => {
    if (!markdown) return markdown;
    return markdown.replace(pattern, (segment: string, _fence: string | undefined, plainName: string | undefined) => {
      if (plainName !== undefined) return `[${plainName}](${buildKbCitationHref(plainName)})`;
      const codeSpan = INLINE_CODE_SPAN.exec(segment);
      if (codeSpan) {
        const inner = codeSpan[2].trim();
        if (nameSet.has(inner)) return `[${segment}](${buildKbCitationHref(inner)})`;
      }
      return segment;
    });
  };
};
```

- [ ] **Step 2.4: Run tests — expect PASS**

Run: `bun run test -- tests/unit/knowledge/linkifyKnownSources.test.ts`

- [ ] **Step 2.5: Commit**

```bash
git add packages/desktop/src/renderer/utils/chat/linkifyKnownSources.ts tests/unit/knowledge/linkifyKnownSources.test.ts
git commit -m "feat(chat): linkify known knowledge source names in assistant markdown"
```

---

### Task 3: MarkdownView — intercept `weprompt-kb://` before external handling

**Files:**
- Modify: `packages/desktop/src/renderer/components/Markdown/index.tsx`
- Test: `tests/unit/knowledge/MarkdownViewKbLink.dom.test.tsx`

- [ ] **Step 3.1: Write the failing dom test**

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildKbCitationHref } from '@/common/knowledge/citationFormat';
import MarkdownView from '@/renderer/components/Markdown';

const mockOpenExternalUrl = vi.fn().mockResolvedValue(undefined);
vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: (...args: unknown[]) => mockOpenExternalUrl(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));

const shadowBody = (container: HTMLElement): HTMLElement => {
  const host = container.querySelector('div.relative > div') as HTMLElement; // ShadowView host
  const root = (host?.shadowRoot ?? null) as ShadowRoot | null;
  const body = root?.querySelector('.markdown-shadow-body') as HTMLElement | null;
  if (!body) throw new Error('markdown shadow body not found');
  return body;
};

describe('MarkdownView weprompt-kb link interception', () => {
  it('invokes onKbCitationClick and never openExternalUrl', async () => {
    const onKbCitationClick = vi.fn();
    const href = buildKbCitationHref('hop-dong.pdf', 'Pages 1–3');
    const { container } = render(
      <MarkdownView onKbCitationClick={onKbCitationClick}>{`See [\`hop-dong.pdf\`](${href}).`}</MarkdownView>
    );
    await waitFor(() => expect(shadowBody(container).querySelector('a')).toBeTruthy());
    const anchor = shadowBody(container).querySelector('a') as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe(href);
    fireEvent.click(anchor);
    expect(onKbCitationClick).toHaveBeenCalledWith('hop-dong.pdf', 'Pages 1–3');
    expect(mockOpenExternalUrl).not.toHaveBeenCalled();
  });

  it('swallows kb links even without a handler (scheme never leaks)', async () => {
    const { container } = render(<MarkdownView>{`[hop-dong.pdf](${buildKbCitationHref('hop-dong.pdf')})`}</MarkdownView>);
    await waitFor(() => expect(shadowBody(container).querySelector('a')).toBeTruthy());
    fireEvent.click(shadowBody(container).querySelector('a') as HTMLAnchorElement);
    expect(mockOpenExternalUrl).not.toHaveBeenCalled();
  });

  it('still opens normal links externally', async () => {
    const { container } = render(<MarkdownView>{'[x](https://example.com/)'}</MarkdownView>);
    await waitFor(() => expect(shadowBody(container).querySelector('a')).toBeTruthy());
    fireEvent.click(shadowBody(container).querySelector('a') as HTMLAnchorElement);
    expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://example.com/');
  });
});
```

Note: if the `shadowBody` selector guess is wrong, inspect `container.innerHTML` for the ShadowView host and fix the selector — the shadow root is `mode: 'open'` (ShadowView.tsx:416). If ShadowView needs a LayoutContext/ipcBridge mock to mount under jsdom, add the minimal `vi.mock` the error demands.

- [ ] **Step 3.2: Run it — expect FAIL (no `onKbCitationClick` prop; href stripped by defaultUrlTransform)**

Run: `bun run test -- tests/unit/knowledge/MarkdownViewKbLink.dom.test.tsx`

- [ ] **Step 3.3: Implement in `Markdown/index.tsx`**

Add import:

```ts
import { isKbCitationHref, parseKbCitationHref } from '@/common/knowledge/citationFormat';
```

Add prop to `MarkdownViewProps` and destructure it:

```ts
  /** Invoked for weprompt-kb:// citation links; the scheme never reaches openExternalUrl. */
  onKbCitationClick?: (fileName: string, anchor?: string) => void;
```

Replace `handleLinkClick` (keep `e.preventDefault/stopPropagation` first):

```ts
    const handleLinkClick = useCallback(
      (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const anchorEl = e.currentTarget as HTMLAnchorElement;
        const href = anchorEl.getAttribute('href') || anchorEl.href;
        if (!href) return;
        // Citation links are app-internal: handle (or drop) them before any
        // external-URL path — the scheme must never leak to the OS browser.
        const citation = parseKbCitationHref(href);
        if (citation || isKbCitationHref(href)) {
          if (citation) onKbCitationClick?.(citation.fileName, citation.anchor);
          return;
        }
        openExternalUrl(href).catch((error: unknown) => {
          console.error(t('messages.openLinkFailed'), error);
        });
      },
      [t, onKbCitationClick]
    );
```

Whitelist the scheme in `urlTransform` (line ~154):

```ts
              urlTransform={(url) => (isKbCitationHref(url) || resolveLocalFileLinkPath(url) ? url : defaultUrlTransform(url))}
```

(`handleLinkClick` is already a dep of the `components` useMemo — no dep change needed there.)

- [ ] **Step 3.4: Run tests — expect PASS**

Run: `bun run test -- tests/unit/knowledge/MarkdownViewKbLink.dom.test.tsx`

- [ ] **Step 3.5: Commit**

```bash
git add packages/desktop/src/renderer/components/Markdown/index.tsx tests/unit/knowledge/MarkdownViewKbLink.dom.test.tsx
git commit -m "feat(chat): intercept weprompt-kb citation links inside MarkdownView"
```

---

### Task 4: Citations provider + drawer + anchor scroll + i18n

**Files:**
- Create: `packages/desktop/src/renderer/pages/conversation/knowledge/KnowledgeCitationsContext.tsx`
- Create: `packages/desktop/src/renderer/pages/project/components/knowledgePreviewAnchor.ts`
- Modify: `packages/desktop/src/renderer/pages/project/components/KnowledgeSourcePreview.tsx` (optional `anchor` prop + scroll effect)
- Modify: `packages/desktop/src/renderer/pages/conversation/components/ChatConversation.tsx` (mount provider on both return paths)
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/conversation.json` ×12 (`projectHome.knowledgeCitationMissing`)
- Regenerate: i18n types via `bun run i18n:types`
- Test: `tests/unit/knowledge/knowledgePreviewAnchor.dom.test.ts`, `tests/unit/knowledge/KnowledgeCitationsProvider.dom.test.tsx`

- [ ] **Step 4.1: Failing test — anchor heading finder**

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { findCitationHeading } from '@/renderer/pages/project/components/knowledgePreviewAnchor';

const buildTree = (html: string): HTMLElement => {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const container = document.createElement('div');
  container.innerHTML = html;
  shadow.appendChild(container);
  return container;
};

describe('findCitationHeading', () => {
  it('finds the page heading for a page-range anchor', () => {
    const tree = buildTree('<h2>Page 1</h2><p>a</p><h2>Page 2</h2><p>b</p>');
    expect(findCitationHeading(tree, 'Pages 2–3')?.textContent).toBe('Page 2');
  });

  it('finds the most specific heading of a trail', () => {
    const tree = buildTree('<h1>HR</h1><h2>Visa letters</h2>');
    expect(findCitationHeading(tree, 'HR > Visa letters')?.textContent).toBe('Visa letters');
  });

  it('returns null when nothing matches or the anchor is blank', () => {
    const tree = buildTree('<h2>Other</h2>');
    expect(findCitationHeading(tree, 'Missing heading')).toBeNull();
    expect(findCitationHeading(tree, '')).toBeNull();
  });
});
```

- [ ] **Step 4.2: Implement `knowledgePreviewAnchor.ts`**

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveAnchorHeadingText } from '@/common/knowledge/citationFormat';

/**
 * Locate the preview heading a citation anchor points at, inside the drawer's
 * rendered markdown container (which lives in a shadow root — callers pass the
 * in-shadow element, so plain querySelectorAll works). Exact trimmed-text
 * match only; no match means "open at top", never an error.
 */
export const findCitationHeading = (container: ParentNode, anchor: string): HTMLElement | null => {
  const target = resolveAnchorHeadingText(anchor);
  if (!target) return null;
  const headings = container.querySelectorAll('h1,h2,h3,h4,h5,h6');
  for (const heading of headings) {
    if ((heading.textContent ?? '').trim() === target) return heading as HTMLElement;
  }
  return null;
};
```

Run: `bun run test -- tests/unit/knowledge/knowledgePreviewAnchor.dom.test.ts` → PASS.

- [ ] **Step 4.3: Extend `KnowledgeSourcePreview` with `anchor`**

Add to props type: `anchor?: string;`. Add refs/effect inside the component (imports: `useCallback, useEffect, useRef` from react, `findCitationHeading` from `./knowledgePreviewAnchor`):

```tsx
  const markdownBodyRef = useRef<HTMLDivElement | null>(null);
  const handleMarkdownRef = useCallback((el?: HTMLDivElement | null) => {
    markdownBodyRef.current = el ?? null;
  }, []);

  // Scroll the loaded preview to the cited section. One frame lets the
  // markdown commit inside the drawer before we measure; no match → stay at top.
  useEffect(() => {
    if (loading || failed || !anchor || fileName === null) return;
    const frame = requestAnimationFrame(() => {
      const container = markdownBodyRef.current;
      if (!container) return;
      const heading = findCitationHeading(container, anchor);
      heading?.scrollIntoView?.({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [anchor, failed, fileName, loading, text]);
```

And pass the ref: `<MarkdownView hiddenCodeCopyButton onRef={handleMarkdownRef}>{text}</MarkdownView>`.

- [ ] **Step 4.4: Add the i18n key to all 12 locales**

In each `renderer/services/i18n/locales/<locale>/conversation.json`, inside the `projectHome` object right after `knowledgePreviewError` (keep each file's key order consistent):

- en-US: `"knowledgeCitationMissing": "This file is no longer in the knowledge base."`
- zh-CN: `"knowledgeCitationMissing": "该文件已不在知识库中。"`
- zh-TW: `"knowledgeCitationMissing": "該檔案已不在知識庫中。"`
- ja-JP: `"knowledgeCitationMissing": "このファイルはナレッジベースにもうありません。"`
- ko-KR: `"knowledgeCitationMissing": "이 파일은 더 이상 지식 베이스에 없습니다."`
- de-DE: `"knowledgeCitationMissing": "Diese Datei ist nicht mehr in der Wissensdatenbank."`
- es-ES: `"knowledgeCitationMissing": "Este archivo ya no está en la base de conocimientos."`
- pt-BR: `"knowledgeCitationMissing": "Este arquivo não está mais na base de conhecimento."`
- ru-RU: `"knowledgeCitationMissing": "Этот файл больше не находится в базе знаний."`
- tr-TR: `"knowledgeCitationMissing": "Bu dosya artık bilgi tabanında değil."`
- uk-UA: `"knowledgeCitationMissing": "Цього файлу більше немає в базі знань."`
- fa-IR: `"knowledgeCitationMissing": "این فایل دیگر در پایگاه دانش موجود نیست."`

Before writing, check each locale's existing `knowledge*` strings and reuse that locale's established term for "knowledge base". Then:

Run: `bun run i18n:types && node scripts/check-i18n.js` → both clean.

- [ ] **Step 4.5: Failing test — provider dom test**

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';

const mockListSources = vi.fn();
const mockGetSourceText = vi.fn();
const mockOpenFile = vi.fn().mockResolvedValue(undefined);
const mockUpdatedOn = vi.fn(() => () => undefined);
const mockMessageWarning = vi.fn();

vi.mock('@/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/common')>();
  return {
    ...actual,
    ipcBridge: {
      ...actual.ipcBridge,
      projectKnowledge: {
        ...actual.ipcBridge.projectKnowledge,
        listSources: { invoke: (...args: unknown[]) => mockListSources(...args) },
        getSourceText: { invoke: (...args: unknown[]) => mockGetSourceText(...args) },
        updated: { on: (...args: unknown[]) => mockUpdatedOn(...args) },
      },
      shell: {
        ...actual.ipcBridge.shell,
        openFile: { invoke: (...args: unknown[]) => mockOpenFile(...args) },
      },
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: { ...actual.Message, warning: (...args: unknown[]) => mockMessageWarning(...args) },
  };
});

import {
  KnowledgeCitationsProvider,
  useKnowledgeCitationsSafe,
} from '@/renderer/pages/conversation/knowledge/KnowledgeCitationsContext';

const SOURCE = {
  id: 'src-1',
  fileName: 'hop-dong-ctv-scan.pdf',
  contentHash: 'sha256:1',
  byteSize: 10,
  status: 'ready',
  chunkCount: 1,
  vectorCount: 1,
  addedAt: 1,
  error: null,
};

const conversation = {
  id: 'conv-1',
  type: 'acp',
  extra: { project_id: 'proj-1', workspace: '/tmp/ws' },
} as unknown as TChatConversation;

const Probe: React.FC<{ fileName: string; anchor?: string }> = ({ fileName, anchor }) => {
  const citations = useKnowledgeCitationsSafe();
  if (!citations) return <span data-testid='no-citations' />;
  return (
    <button data-testid='open-citation' onClick={() => citations.openCitation(fileName, anchor)}>
      {citations.linkify('see hop-dong-ctv-scan.pdf')}
    </button>
  );
};

beforeEach(() => {
  mockListSources.mockReset().mockResolvedValue({ sources: [SOURCE], summary: null, folderMissing: false });
  mockGetSourceText.mockReset().mockResolvedValue({ text: '## Page 1\n\nbody', truncated: false });
  mockMessageWarning.mockClear();
  mockOpenFile.mockClear();
});

describe('KnowledgeCitationsProvider', () => {
  it('provides no context (and fetches nothing) without a project_id', () => {
    const plain = { id: 'c', type: 'acp', extra: { workspace: '/tmp/ws' } } as unknown as TChatConversation;
    render(
      <KnowledgeCitationsProvider conversation={plain}>
        <Probe fileName='hop-dong-ctv-scan.pdf' />
      </KnowledgeCitationsProvider>
    );
    expect(screen.getByTestId('no-citations')).toBeTruthy();
    expect(mockListSources).not.toHaveBeenCalled();
  });

  it('linkifies known names and opens the drawer with fetched text on click', async () => {
    render(
      <KnowledgeCitationsProvider conversation={conversation}>
        <Probe fileName='hop-dong-ctv-scan.pdf' anchor='Pages 1–3' />
      </KnowledgeCitationsProvider>
    );
    await waitFor(() => expect(mockListSources).toHaveBeenCalledWith({ projectId: 'proj-1' }));
    await waitFor(() =>
      expect(screen.getByTestId('open-citation').textContent).toContain('](weprompt-kb://open?file=')
    );
    fireEvent.click(screen.getByTestId('open-citation'));
    await waitFor(() =>
      expect(mockGetSourceText).toHaveBeenCalledWith({ projectId: 'proj-1', sourceId: 'src-1' })
    );
    // Drawer title is light-DOM (Arco); the drawer is open when the fileName shows.
    await waitFor(() => expect(screen.getByText('hop-dong-ctv-scan.pdf')).toBeTruthy());
    expect(mockMessageWarning).not.toHaveBeenCalled();
  });

  it('re-checks the source list then toasts when the file is gone', async () => {
    render(
      <KnowledgeCitationsProvider conversation={conversation}>
        <Probe fileName='deleted.pdf' />
      </KnowledgeCitationsProvider>
    );
    await waitFor(() => expect(mockListSources).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('open-citation'));
    await waitFor(() => expect(mockMessageWarning).toHaveBeenCalledWith('conversation.projectHome.knowledgeCitationMissing'));
    expect(mockGetSourceText).not.toHaveBeenCalled();
    expect(mockListSources.mock.calls.length).toBeGreaterThanOrEqual(2); // initial + click-time re-check
  });
});
```

- [ ] **Step 4.6: Implement `KnowledgeCitationsContext.tsx`**

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { KNOWLEDGE_FOLDER_NAME } from '@/common/knowledge/constants';
import type { IKnowledgeSourceDto } from '@/common/types/project/knowledgeTypes';
import KnowledgeSourcePreview from '@/renderer/pages/project/components/KnowledgeSourcePreview';
import { buildSourceLinkifier } from '@renderer/utils/chat/linkifyKnownSources';
import { Message } from '@arco-design/web-react';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type KnowledgeCitationsValue = {
  /** Known source fileNames — the only strings citation recognition may match. */
  fileNames: readonly string[];
  /** Pure, memoized markdown transform wrapping known names as weprompt-kb links. */
  linkify: (markdown: string) => string;
  /** Resolve a fileName to its source and open the preview drawer (toast when gone). */
  openCitation: (fileName: string, anchor?: string) => void;
};

const KnowledgeCitationsContext = createContext<KnowledgeCitationsValue | null>(null);

/** Null outside a project conversation — callers then skip all citation work. */
export const useKnowledgeCitationsSafe = (): KnowledgeCitationsValue | null => useContext(KnowledgeCitationsContext);

type PreviewState = {
  fileName: string | null;
  text: string;
  truncated: boolean;
  loading: boolean;
  failed: boolean;
  anchor?: string;
};

const EMPTY_PREVIEW: PreviewState = { fileName: null, text: '', truncated: false, loading: false, failed: false };

/**
 * Conversation-level controller for KB citation click-through. For project
 * conversations it caches the source list (refreshed on the main process's
 * `projectKnowledge.updated` push) and owns the preview drawer; for everything
 * else it renders children untouched and provides no context.
 */
export const KnowledgeCitationsProvider: React.FC<{
  conversation?: TChatConversation;
  children: React.ReactNode;
}> = ({ conversation, children }) => {
  const { t } = useTranslation();
  const extra = conversation?.extra as { project_id?: string; workspace?: string } | undefined;
  const projectId = extra?.project_id;
  const workspace = extra?.workspace;

  const [sources, setSources] = useState<IKnowledgeSourceDto[]>([]);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const [preview, setPreview] = useState<PreviewState>(EMPTY_PREVIEW);
  const openSeqRef = useRef(0);

  useEffect(() => {
    if (!projectId) return;
    let disposed = false;
    const refetch = async () => {
      try {
        const result = await ipcBridge.projectKnowledge.listSources.invoke({ projectId });
        if (!disposed) setSources(result.sources);
      } catch (error) {
        console.error('Failed to load knowledge sources for citations:', error);
      }
    };
    void refetch();
    const unsubscribe = ipcBridge.projectKnowledge.updated.on((payload) => {
      if (payload.projectId === projectId) void refetch();
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [projectId]);

  const fileNames = useMemo(() => sources.map((source) => source.fileName), [sources]);
  const linkify = useMemo(() => buildSourceLinkifier(fileNames), [fileNames]);

  const openCitation = useCallback(
    (fileName: string, anchor?: string) => {
      if (!projectId) return;
      const seq = ++openSeqRef.current;
      void (async () => {
        let source = sourcesRef.current.find((candidate) => candidate.fileName === fileName);
        if (!source) {
          // The cached list can trail reality (deletion in another surface) —
          // one fresh look before declaring the file gone.
          try {
            const result = await ipcBridge.projectKnowledge.listSources.invoke({ projectId });
            setSources(result.sources);
            source = result.sources.find((candidate) => candidate.fileName === fileName);
          } catch (error) {
            console.error('Failed to refresh knowledge sources for citation:', error);
          }
        }
        if (seq !== openSeqRef.current) return;
        if (!source) {
          Message.warning(t('conversation.projectHome.knowledgeCitationMissing'));
          return;
        }
        setPreview({ fileName, text: '', truncated: false, loading: true, failed: false, anchor });
        try {
          const { text, truncated } = await ipcBridge.projectKnowledge.getSourceText.invoke({
            projectId,
            sourceId: source.id,
          });
          if (seq !== openSeqRef.current) return;
          setPreview({ fileName, text, truncated, loading: false, failed: false, anchor });
        } catch (error) {
          console.error('Failed to load indexed text for citation:', error);
          if (seq !== openSeqRef.current) return;
          setPreview({ fileName, text: '', truncated: false, loading: false, failed: true, anchor });
        }
      })();
    },
    [projectId, t]
  );

  const value = useMemo<KnowledgeCitationsValue>(
    () => ({ fileNames, linkify, openCitation }),
    [fileNames, linkify, openCitation]
  );

  return (
    <KnowledgeCitationsContext.Provider value={projectId ? value : null}>
      {children}
      {projectId && (
        <KnowledgeSourcePreview
          fileName={preview.fileName}
          text={preview.text}
          truncated={preview.truncated}
          loading={preview.loading}
          failed={preview.failed}
          anchor={preview.anchor}
          onClose={() => setPreview(EMPTY_PREVIEW)}
          onOpenOriginal={() => {
            if (preview.fileName && workspace) {
              void ipcBridge.shell.openFile.invoke(`${workspace}/${KNOWLEDGE_FOLDER_NAME}/${preview.fileName}`);
            }
          }}
        />
      )}
    </KnowledgeCitationsContext.Provider>
  );
};
```

Run: `bun run test -- tests/unit/knowledge/KnowledgeCitationsProvider.dom.test.tsx` → PASS.

- [ ] **Step 4.7: Mount the provider in `ChatConversation.tsx`**

Import: `import { KnowledgeCitationsProvider } from '../knowledge/KnowledgeCitationsContext';`

Wrap BOTH return paths:

```tsx
  if (conversation && conversation.type === 'aionrs') {
    return (
      <KnowledgeCitationsProvider conversation={conversation}>
        <AionrsConversationPanel key={conversation.id} conversation={conversation} sliderTitle={sliderTitle} />
      </KnowledgeCitationsProvider>
    );
  }
```

and wrap the final `<ChatLayout …>…</ChatLayout>` in `<KnowledgeCitationsProvider conversation={conversation}>…</KnowledgeCitationsProvider>`.

- [ ] **Step 4.8: Commit**

```bash
git add packages/desktop/src/renderer/pages/conversation/knowledge/KnowledgeCitationsContext.tsx packages/desktop/src/renderer/pages/project/components/knowledgePreviewAnchor.ts packages/desktop/src/renderer/pages/project/components/KnowledgeSourcePreview.tsx packages/desktop/src/renderer/pages/conversation/components/ChatConversation.tsx packages/desktop/src/renderer/services/i18n/locales tests/unit/knowledge/knowledgePreviewAnchor.dom.test.ts tests/unit/knowledge/KnowledgeCitationsProvider.dom.test.tsx <i18n-types-output-file>
git commit -m "feat(chat): knowledge citations provider with preview drawer and section scroll"
```

---

### Task 5: MessageText — apply the linkifier to assistant markdown

**Files:**
- Modify: `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageText.tsx`

- [ ] **Step 5.1: Implement (covered by Task 2 unit tests + live verification)**

Imports:

```ts
import { useKnowledgeCitationsSafe } from '@/renderer/pages/conversation/knowledge/KnowledgeCitationsContext';
```

Inside the component, with the other hooks (BEFORE the early `return null`):

```ts
  const citations = useKnowledgeCitationsSafe();
  // Citation linkify runs on the exact string MarkdownView receives (post
  // progressive-reveal): pure + memoized; partially revealed names simply
  // don't match until the stream completes them.
  const markdownSource = shouldRevealStream || isRevealing ? displayedText : data;
  const linkifiedMarkdown = useMemo(() => {
    if (!citations || isUserMessage || json || typeof markdownSource !== 'string') return markdownSource;
    return citations.linkify(markdownSource);
  }, [citations, isUserMessage, json, markdownSource]);
```

Replace the final MarkdownView usage (non-json branch):

```tsx
            <div data-testid='message-text-content'>
              <MarkdownView codeStyle={CODE_STYLE} onLocalFileLink={handleLocalFileLink} onKbCitationClick={citations?.openCitation}>
                {linkifiedMarkdown}
              </MarkdownView>
            </div>
```

- [ ] **Step 5.2: Run the chat dom-test suite to catch regressions**

Run: `bun run test -- tests/unit/chat/`
Expected: PASS.

- [ ] **Step 5.3: Commit**

```bash
git add packages/desktop/src/renderer/pages/conversation/Messages/components/MessageText.tsx
git commit -m "feat(chat): make knowledge source citations clickable in assistant replies"
```

---

### Task 6: Tool-result block — clickable citation lines

**Files:**
- Create: `packages/desktop/src/renderer/pages/conversation/Messages/components/ToolOutputCitations.tsx`
- Modify: `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx` (~line 392)
- Modify: `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.css` (link style)
- Test: `tests/unit/knowledge/ToolOutputCitations.dom.test.tsx`

- [ ] **Step 6.1: Write the failing dom test**

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ToolOutputCitations, {
  toolUsesKnowledgeSearch,
} from '@/renderer/pages/conversation/Messages/components/ToolOutputCitations';
import {
  KnowledgeCitationsTestProvider,
} from './knowledgeCitationsTestUtils'; // small local helper providing a stub context value

const OUTPUT =
  'Found 2 passage(s) in the project knowledge base for "hop dong":' +
  '\n\n[1] hop-dong-ctv-scan.pdf — Pages 1–3\ndieu khoan' +
  '\n\n[2] deleted.pdf\nold text';

describe('toolUsesKnowledgeSearch', () => {
  it('matches titles containing the tool name and rejects others', () => {
    expect(toolUsesKnowledgeSearch('search_project_knowledge')).toBe(true);
    expect(toolUsesKnowledgeSearch('project-knowledge:search_project_knowledge (MCP)')).toBe(true);
    expect(toolUsesKnowledgeSearch('Read')).toBe(false);
    expect(toolUsesKnowledgeSearch(undefined)).toBe(false);
  });
});

describe('ToolOutputCitations', () => {
  it('links citation header fileNames and passes the heading anchor on click', () => {
    const openCitation = vi.fn();
    const { container } = render(
      <KnowledgeCitationsTestProvider fileNames={['hop-dong-ctv-scan.pdf']} openCitation={openCitation}>
        <pre>
          <ToolOutputCitations output={OUTPUT} />
        </pre>
      </KnowledgeCitationsTestProvider>
    );
    const links = container.querySelectorAll('a.kb-citation-link');
    expect(links.length).toBe(2); // format-recognized even when no longer listed
    fireEvent.click(links[0]);
    expect(openCitation).toHaveBeenCalledWith('hop-dong-ctv-scan.pdf', 'Pages 1–3');
    fireEvent.click(links[1]);
    expect(openCitation).toHaveBeenCalledWith('deleted.pdf', undefined);
    expect(container.textContent).toBe(OUTPUT); // wording untouched
  });

  it('does not link body lines that merely look like citations mid-paragraph', () => {
    const openCitation = vi.fn();
    const tricky = 'Found 1 passage(s) in the project knowledge base for "x":\n\n[1] a.md — H\nbody line\n[2] fake.md — H';
    const { container } = render(
      <KnowledgeCitationsTestProvider fileNames={['a.md']} openCitation={openCitation}>
        <ToolOutputCitations output={tricky} />
      </KnowledgeCitationsTestProvider>
    );
    // Only the blank-line-preceded header is linked.
    expect(container.querySelectorAll('a.kb-citation-link').length).toBe(1);
  });

  it('renders plain text without a citations context', () => {
    const { container } = render(<ToolOutputCitations output={OUTPUT} />);
    expect(container.querySelectorAll('a').length).toBe(0);
    expect(container.textContent).toBe(OUTPUT);
  });
});
```

The test helper `tests/unit/knowledge/knowledgeCitationsTestUtils.tsx` — export the real context via a test-only provider. To keep production surface minimal, export the raw context object from `KnowledgeCitationsContext.tsx` as `KnowledgeCitationsRawContext` (typed, documented as test/advanced seam) and build the helper on it:

```tsx
import React from 'react';
import { KnowledgeCitationsRawContext, type KnowledgeCitationsValue } from '@/renderer/pages/conversation/knowledge/KnowledgeCitationsContext';
import { buildSourceLinkifier } from '@renderer/utils/chat/linkifyKnownSources';

export const KnowledgeCitationsTestProvider: React.FC<{
  fileNames: string[];
  openCitation: KnowledgeCitationsValue['openCitation'];
  children: React.ReactNode;
}> = ({ fileNames, openCitation, children }) => (
  <KnowledgeCitationsRawContext.Provider value={{ fileNames, linkify: buildSourceLinkifier(fileNames), openCitation }}>
    {children}
  </KnowledgeCitationsRawContext.Provider>
);
```

- [ ] **Step 6.2: Implement `ToolOutputCitations.tsx`**

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseCitationHeader } from '@/common/knowledge/citationFormat';
import { useKnowledgeCitationsSafe } from '@/renderer/pages/conversation/knowledge/KnowledgeCitationsContext';
import React from 'react';

// The knowledge search tool's result block renders as plain <pre> text inside
// the work journal. Its citation headers (`[n] fileName — headingPath`) are OUR
// format (see citationFormat.ts), so recognition here is format-driven rather
// than known-name-driven — a header stays clickable after its source is
// deleted, and clicking it surfaces the "no longer in the knowledge base"
// toast instead of going silently dead.

const KNOWLEDGE_SEARCH_TOOL = 'search_project_knowledge';

export const toolUsesKnowledgeSearch = (name: string | undefined): boolean =>
  Boolean(name && name.includes(KNOWLEDGE_SEARCH_TOOL));

/** Citation headers cite real files — require a sane dot-extension. */
const FILE_EXTENSION_PATTERN = /\.[A-Za-z0-9]{1,8}$/;

const ToolOutputCitations: React.FC<{ output: string }> = ({ output }) => {
  const citations = useKnowledgeCitationsSafe();
  if (!citations) return <>{output}</>;
  const lines = output.split('\n');
  return (
    <>
      {lines.map((line, index) => {
        const suffix = index < lines.length - 1 ? '\n' : '';
        // Real headers are always preceded by a blank line (formatHitsAsText
        // joins blocks with \n\n) — passage text that merely looks like a
        // header stays plain.
        const parsed = index > 0 && lines[index - 1].trim() === '' ? parseCitationHeader(line, citations.fileNames) : null;
        if (!parsed || !FILE_EXTENSION_PATTERN.test(parsed.fileName)) {
          return <React.Fragment key={index}>{line + suffix}</React.Fragment>;
        }
        const prefix = `[${parsed.ordinal}] `;
        const headingSuffix = parsed.headingPath ? ` — ${parsed.headingPath}` : '';
        return (
          <React.Fragment key={index}>
            {prefix}
            <a
              className='kb-citation-link'
              role='button'
              tabIndex={0}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                citations.openCitation(parsed.fileName, parsed.headingPath);
              }}
            >
              {parsed.fileName}
            </a>
            {headingSuffix + suffix}
          </React.Fragment>
        );
      })}
    </>
  );
};

export default ToolOutputCitations;
```

- [ ] **Step 6.3: Wire into `ToolItemDetail` + style**

`MessageToolGroupSummary.tsx` (~line 392), replace the output pre content:

```tsx
              <pre className='tool-detail-content'>
                {toolUsesKnowledgeSearch(displayItem.name) ? (
                  <ToolOutputCitations output={displayItem.output} />
                ) : (
                  displayItem.output
                )}
              </pre>
```

with imports `import ToolOutputCitations, { toolUsesKnowledgeSearch } from './ToolOutputCitations';`.

`MessageToolGroupSummary.css` append:

```css
.tool-detail-content .kb-citation-link {
  color: var(--primary);
  cursor: pointer;
  text-decoration: none;
}
.tool-detail-content .kb-citation-link:hover {
  text-decoration: underline;
}
```

- [ ] **Step 6.4: Run tests**

Run: `bun run test -- tests/unit/knowledge/ToolOutputCitations.dom.test.tsx tests/unit/chat/MessageToolGroupSummary.dom.test.tsx`
Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
git add packages/desktop/src/renderer/pages/conversation/Messages/components/ToolOutputCitations.tsx packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.css tests/unit/knowledge/ToolOutputCitations.dom.test.tsx tests/unit/knowledge/knowledgeCitationsTestUtils.tsx tests/unit/knowledge/KnowledgeCitationsProvider.dom.test.tsx
git commit -m "feat(chat): clickable citation lines in the knowledge search tool result"
```

---

### Task 7: Gate

- [ ] `bun run test` — full suite green.
- [ ] `bunx tsc --noEmit` — clean.
- [ ] `bun run lint:fix` — 0 errors (warnings ≤ baseline ~847).
- [ ] `node scripts/check-i18n.js` — clean; `bun run i18n:types` output committed.
- [ ] `bunx oxfmt <changed files only>` — scoped format; commit any diffs.

### Task 8: Live verification (required)

1. Launch the dev app (per weprompt-dev-run memory; only one dev app at a time).
2. Open the project containing `hop-dong-ctv-scan.pdf`; new project chat; ask something answered from that file (e.g. "Điều khoản thanh toán trong hợp đồng CTV là gì?").
3. Confirm: fileName in the ANSWER TEXT renders as a link; click → drawer opens → scrolled to the cited `## Page N`.
4. Expand the search tool step in the work journal; confirm the `[1] hop-dong-ctv-scan.pdf — Pages …` line is clickable; click → drawer scrolled to the page.
   - If not clickable, log the real `displayItem.name` (tool title) and adjust `toolUsesKnowledgeSearch`.
5. "Open original" → file opens in the OS viewer.
6. Delete the file via Project Home's knowledge card; back in the chat, click the tool-block citation again → toast `knowledgeCitationMissing`, no drawer.
7. Non-project chat sanity: mention `hop-dong-ctv-scan.pdf` in a plain chat — no links, no fetches.

## Self-review checklist (done during planning)

- Spec coverage: both surfaces (T5, T6); recognition rules (T2 prose exact-match, T6 format+blank-line+extension gates); scheme interception before external handling + urlTransform whitelist (T3); shared format module + byte-identical fixture + round-trip (T1); controller + drawer + toast + openOriginal (T4); scroll-to-section incl. Pages mapping (T1/T4); zero new IPC channels (only existing invokes used); i18n ×12 + types + check (T4); memoization/purity/idempotence (T2 tests, T4/T5 useMemo); non-project zero-work (T4 test).
- Placeholders: none — all steps carry full code.
- Type consistency: `KnowledgeCitationsValue.openCitation(fileName, anchor?)` used identically in T3 (MarkdownView prop signature), T5, T6; `PreviewState.anchor` flows to `KnowledgeSourcePreview.anchor`; `parseCitationHeader(line, knownFileNames?)` matches T1 definition at all call sites.
