# Stream A — PDF Ingestion for the Project Knowledge Base

**Date:** 2026-07-28
**Branch:** `feat/kb-pdf-ingestion` off `feat/project-knowledge-base` (worktree `WePrompt-kb-pdf`)
**Read first:** `2026-07-28-kb-followups-coordination.md`

## 1. Why

The knowledge base currently accepts `.md`, `.txt`, `.docx`, `.xlsx` and rejects `.pdf` as `Unsupported`. The audience is VNG back-office — HR, TSE, Legal, FA — whose documents are overwhelmingly PDFs: contracts, invoices, debit statements, scanned forms. The user's own first indexed document references `FA-PM260226080.pdf`. Without PDF the feature indexes the summaries people write *about* their work rather than the work itself.

**Scope decision (user, 2026-07-28): full scope — text-layer PDFs *and* scanned PDFs via OCR.**

## 2. Two kinds of PDF, two paths

| Kind | Detection | Extraction | Cost |
| --- | --- | --- | --- |
| **Text-layer** (exported from Word, most invoices/statements) | `pdfjs-dist` yields non-trivial text | local, synchronous, no network | milliseconds |
| **Scanned / image-only** (photographed or scanned contracts) | text extraction yields ~nothing | GreenNode IDP OCR over the network | seconds-to-minutes, poll-based |

**Try local first, always.** Only fall back to OCR when the local pass produces effectively no text. Most real PDFs have a text layer, so the expensive path should be the exception.

Suggested heuristic: extract per page; if total extracted characters across the document fall below a threshold (start with ~100 chars, or <20 chars/page averaged), treat it as scanned. Validate this threshold against real samples before fixing it.

## 3. The OCR problem — read this before designing

`executeIdp` (`packages/desktop/src/common/chat/idpCore.ts`) is reusable from the main process — same injectable-`fetchImpl` shape as `visionCore`/`embedCore`, config `{ ingestUrl, apiKey }`. Good news.

**But it does not return page text.** It returns:

```ts
return { success: true, text: JSON.stringify(parsed.data?.documents ?? parsed.data ?? {}) };
```

— a JSON blob of *structured field extraction* (it is an IDP product aimed at ID cards, invoices, KYC forms), produced via an **ingest-then-poll** cycle with a `maxPolls` timeout.

Two consequences:

1. **Indexing that JSON verbatim would poison retrieval.** Chunks would be full of `{"field_name":"value"}` syntax; BM25 would index braces and key names, and embeddings would encode JSON structure rather than meaning.
2. **It is slow and asynchronous**, which is what forces the progress/caps/partial-persistence work below.

### OUTCOME OF THE DISCOVERY STEP (2026-07-28) — OCR blocked, not built

The payload was never captured: **the IDP ingest endpoint returns `HTTP 403 Forbidden` for the credential this machine has.** Evidence:

| Check | Result |
| --- | --- |
| `POST <seeded ingest URL>` with `model=idp` (what `buildIdpFormData` sends) | `403 Forbidden` (9-byte body, no JSON) |
| Same POST with `model=greennode/idp` (the id the catalogue advertises) | `403 Forbidden` |
| Same credential → `GET /v1/models` | `200`, 38 models, **including `greennode/idp`** |
| Gateway consumer (`x-consumer-username` on that 200) | `user-108942-user-111288` |
| Tenant hardcoded in `GREENNODE_IDP_BASE_URL` (`common/config/builtinSeed.ts:45`) | `user-111470` |

So the credential is alive and the IDP model is visible to it, but the seeded ingest URL points at **a different tenant's path**, which Kong rejects. Most likely either the URL's tenant segment is stale or this key has no IDP entitlement. Either way it is an environment/credential question, **not** something the flattener design can resolve.

Per §3's own instruction — *do not guess the schema, do not force a bad flattener* — scanned-PDF OCR is **not implemented**. A scanned PDF now fails with an explicit, actionable reason (`SCANNED_PDF_ERROR` in `projectKnowledgeService.ts`) rather than silently indexing zero passages. Everything else in this stream shipped.

**To resume the OCR work:** first get one real payload. Confirm the correct tenant segment for this account (or a key with IDP entitlement), re-run the capture, and only then design the flattener from the real shape. `renderPagesAsMarkdown` in `pdfExtract.ts` is the pattern to mirror, and the PDF branch in `processPending` is the single place a fallback would hook in.

### Required discovery step (do this first, before writing the flattener)

The exact shape of `data.documents` is not documented in this repo. **Make one real IDP call against a representative scanned PDF and capture the JSON.** Only then design the flattener. Do not guess the schema.

```bash
# config lives in the seeded builtin MCP server row
sqlite3 "$HOME/Library/Application Support/Forge-Dev/aionui/aionui-backend.db" \
  "select transport from mcp_servers where name='greennode-idp';"
```

Then call `executeIdp` directly from a scratch script with a sample PDF and pretty-print the result.

**Design the flattener from the real payload**, targeting readable markdown — headings per document/page, `**field**: value` lines, tables as markdown tables. The goal is text a human would find readable, because that is also what chunks and embeds well.

**If the payload turns out to be field-extraction only** (no full page text), record that finding explicitly and reconsider: a field-extraction blob may be genuinely poor knowledge-base material, and the honest answer might be to support text-layer PDFs now and treat scanned-PDF OCR as a separate investigation. **Do not force a bad flattener to satisfy the plan.** Report back instead.

## 4. Throughput and failure — non-negotiable for this stream

Ingestion is **serialized per project** (one promise-chain queue). OCR is a network round-trip with polling. A 50-page scanned contract would therefore occupy that project's queue for minutes, during which the card shows only an `Indexing…` tag with no progress, and any other file the user adds waits behind it.

Additionally, `embedTexts` **discards partial progress** when a batch throws — acceptable at 7 chunks, painful when a large PDF yields hundreds.

This stream must therefore also deliver:

1. **A page cap** (start at 50; make it a named constant beside `MAX_FILE_BYTES`/`MAX_CHUNKS_PER_SOURCE`). Exceeding it truncates and records a non-fatal note on the source — reuse the existing `Truncated to N passages.` convention, which the DTO already documents as a `ready`-compatible note.
2. **Per-source progress.** The manifest needs something like `progress?: { stage: 'converting' | 'indexing' | 'embedding'; done: number; total: number }`, surfaced through `IKnowledgeSourceDto` and rendered in the card (replace the bare `Indexing…` tag with e.g. `Reading page 12/50`). The card already refetches on the `projectKnowledge.updated` push, so emitting an update per page (or per N pages — do not spam) is enough to animate it.
3. **Partial-progress persistence for embeddings.** Persist vectors per batch rather than only after all batches succeed, so a failure at batch 40 of 63 keeps the first 39. This also makes the existing Retry affordance genuinely incremental.

## 5. Where the code goes

**New:** `packages/desktop/src/common/knowledge/pdfExtract.ts` — pure-ish, Node-side, injectable deps. Exposes something like `extractPdfText(buffer, deps?) → Promise<{ pages: string[]; hasTextLayer: boolean }>`. Keep `pdfjs-dist` behind this module so nothing else imports it directly, and so the esbuild bundle for the MCP subprocess is unaffected (the subprocess only *reads* the index; it must not pull in a PDF parser).

**Modified:** `projectKnowledgeService.ts` — add `pdf` to `SUPPORTED_EXTENSIONS`; route it through a new branch (not `CONVERTED_EXTENSIONS`, whose `convertToMarkdown(buffer, 'docx'|'xlsx')` signature does not fit a two-path extractor); thread progress reporting; batch-wise vector persistence.

**Modified:** `projectKnowledgeBridge.ts` — inject the PDF extractor and the IDP config into `buildProjectKnowledgeDeps()`, keeping the service testable with fakes. IDP config comes from the seeded `greennode-idp` MCP row's `transport.env` (`AIONUI_IDP_BASE_URL`, `AIONUI_IDP_API_KEY`).

**Modified:** `ProjectKnowledgeCard.tsx` + 12 locales — progress rendering, and update the `knowledgeSupportedTypes` string to include `.pdf`.

**New dependency:** `pdfjs-dist`. First runtime dep this feature has added — call it out in the MR. Prefer the legacy/Node build; avoid pulling in a worker or DOM assumptions in the main process.

## 6. Testing

Follow the existing knowledge-suite conventions (`tests/unit/knowledge/`, temp-dir stores, injected fakes).

- `pdfExtract`: text-layer PDF yields pages; image-only PDF yields empty/near-empty with `hasTextLayer: false`; a corrupt PDF fails cleanly rather than throwing out of ingestion. Commit two tiny fixture PDFs (a few KB each — do **not** commit large binaries).
- Routing: a text-layer PDF never calls the OCR fake; a scanned one does. This is the assertion that protects the cost model.
- Flattener: real captured IDP JSON (from §3) → expected markdown. Use the actual payload as the fixture, redacted if it contains real personal data — and it likely will, given the document types involved. **Redact before committing.**
- Page cap: a document over the cap truncates, stays `ready`, and carries the note.
- Partial embeddings: a batch failure mid-way leaves earlier vectors persisted; Retry completes the rest.
- Progress: the manifest advances and `onUpdated` fires.

Then the **whole-file gate**: `bun run test`, `bunx tsc --noEmit`, `bun run lint:fix`, `node scripts/check-i18n.js`.

## 7. Live verification (required — do not skip)

The KB build's central lesson is that green tests did not mean a working feature. Verify in the dev app:

1. Add a text-layer PDF → indexes quickly, sensible passages, no OCR call.
2. Add a scanned PDF → progress advances visibly, completes, and the extracted content is genuinely searchable.
3. Ask a project chat something answerable only from the PDF → confirm `search_project_knowledge` is called and the answer cites the PDF.
4. Add an oversized PDF → truncation note, still `ready`, still searchable.

Inspect the resulting chunks on disk before declaring success — readable markdown, not JSON debris.

## 8. Scope guard

**In:** PDF detection, text-layer extraction, OCR fallback, flattening to markdown, page caps, progress, batch-wise vector persistence, tests, i18n.

**Out:** the reranker; embedding provider-id pinning; the key-handling change; citation click-through. **Optional to fold in** (same files, evidence-backed, small): auto-embed backfill / "Embed all" — see coordination doc §3.1.
