# Stream E — Scanned-PDF OCR via VLM (v1 = flatbed scans)

**Date:** 2026-07-29
**Status:** Design approved (v1 scope confirmed by user). **Stream D has landed — the ownership block is lifted and implementation may start.** Amended 2026-07-30 against the post-D `sprint1`; see §10.
**Branch:** `feat/kb-vlm-ocr` off `sprint1` (tip verified `c279f9c39`), own worktree `WePrompt-kb-ocr`.
**Read first:** `2026-07-28-kb-followups-coordination.md`, then `2026-07-28-kb-pdf-ingestion-design.md` (§ "OUTCOME OF THE DISCOVERY STEP" — why IDP is dead).

---

## 1. Why, and why not IDP

Stream A (merged, MR !7/!9) ships text-layer PDF ingestion. Scanned PDFs — the dominant format for the HR/Legal/FA audience — fail with an explicit `SCANNED_PDF_ERROR`. The planned OCR path, GreenNode IDP, is dead twice over:

1. **Unreachable:** the ingest endpoint 403s for this machine's credential (tenant mismatch — Issue #1). Unresolved and out of our hands.
2. **Wrong shape even if reachable:** IDP returns field-extraction JSON, which needed a speculative "flattener" to become indexable prose. A VLM returns markdown natively. Dropping IDP *removes* a component.

**Decision (user, 2026-07-29): drop IDP from the KB pipeline entirely; OCR via a multimodal chat model on the user's configured provider.** The `greennode-idp` MCP tool's fate is a separate decision tracked in Issue #1.

## 2. The empirical base (do not re-derive; re-verify only if the corpus changes)

### 2a. Structure census — 8 real scanned PDFs, first 4 pages each

| Class | Docs | Structure | v1 handling |
| --- | --- | --- | --- |
| **Flatbed scans** (contracts, policies) | 4/8 | exactly **one full-page image per page**, kind 2 (RGB), 1656–2560 px wide; one doc rotated (`page.rotate=270`) | ✅ OCR |
| **Print-composites** (decks, designed exports) | 3/8 | 3–9 images per page (logos, strips, diagrams) — no single image is the page | ❌ per-page skip note |
| **Unresolvable objects** | 1/8 (overlaps above) | `page.objs.get` never resolves for some images | ❌ per-page skip note (3 s timeout) |

Traps the happy path hides, all confirmed:
- **Rotation:** `Internal_QT-HR…` is `rotate=270` on every page. Raw XObject extraction ignores it → sideways input to the VLM. Fix: `sharp.rotate(page.rotate)` (sharp rotates clockwise; pdfjs `rotate` is clockwise display rotation — verify direction with the rotated fixture, not by reasoning).
- **`kind=1` is GRAYSCALE_1BPP — packed bits, width×height/8 bytes.** Feeding it to sharp as 1 byte/pixel produces noise. None in the sample, but CCITT/fax scans are exactly this. v1: **skip kind-1 pages with a note** (unpacking is easy to add later; do not silently corrupt).
- **kind=3 is RGBA** (4 channels). Present in the sample. Channel map: `{1: reject, 2: 3, 3: 4}`.

### 2b. The chain works end to end (proven on a real Vietnamese contract)

`VNG_CS_Quy trinh ky ket hop dong Phu luc 02` page 1 → pdfjs `getOperatorList` + `objs.get` → 2416×3404 raw RGB → `sharp(raw).resize({width: 1600}).jpeg({quality: 80})` = **351 KB in ~30 ms** → MaaS `google/gemma-4-31b-it` chat completion → clean markdown: diacritics intact, headings preserved, the định-nghĩa table reconstructed as a real markdown table. Directly indexable, no flattener.

### 2c. Entitlements are a narrow subset of the catalogue

`/v1/models` lists 38 models; most **404 on chat** for this key. Verified 200: `minimax/minimax-m2.5`, `google/gemma-4-31b-it` (+ embedding models). Verified 404: `gpt-4o`, every Gemini, most Qwens, deepseek, glm. Consequences:
- **Never hardcode the OCR model.** Resolve at runtime (§5).
- The seeded vision server is no fallback: `aionui-image-analysis` is `enabled=0` with an **empty** key in dev.

## 3. v1 scope

**In:** pages that are a single full-page raster (kind 2/3, image area ≥ ~90 % of page area — tune against the census docs), rotation-corrected, OCR'd page-by-page via the resolved VLM; per-page skip notes for everything else; provenance; progress; caps; tests; i18n. **`.text/` materialization is explicitly NOT in scope — see §4a.**

**Out (v2, §11):** composite pages (needs true rasterization), kind-1 unpacking, cross-page table stitching, any reranking of OCR quality.

**Out (separate stream, do not absorb):** extraction *quality* — running-header stripping, hyphenation merge, font-size heading inference, table reconstruction. That work is now unblocked (Stream B landed, §10) and **collides with this stream on the same service file**, so it must be sequenced, not merged in. Decision taken: **Stream E first** — it turns a hard failure into working retrieval, whereas quality work refines text that already indexes.

The honest failure mode is per-page and additive: a 20-page contract with 2 composite pages indexes 18 pages and says so, instead of all-or-nothing.

## 4. Pipeline changes (`projectKnowledgeService.ts`, PDF branch of `processPending`)

Current: `!extraction.hasTextLayer → throw SCANNED_PDF_ERROR`. New:

```
extractPdfText(buffer, {maxPages: MAX_PDF_PAGES, onProgress})   // unchanged, cheap, runs first
if (!hasTextLayer):
    ocrConfig = resolveOcrModel(providers)                       // §5
    if (!ocrConfig) → fail source with SCANNED_PDF_NO_MODEL message (actionable: name what's missing)
    for each page (respecting MAX_PDF_PAGES):
        classify page (single-full-page-image? kind? resolvable?)   // pdfExtract gains extractPageImage()
        eligible → sharp → jpeg → vlmTranscribe() → markdown        // temperature 0, §6 prompt
        ineligible/failed → record page number in skippedPages, continue
    markdown = renderPagesAsMarkdown(pages)                          // reuse; skipped pages are simply absent
    if (all pages skipped) → fail source (reason: no OCR-able pages)
    else → notes.push(`OCR skipped N page(s) …`), manifest.source.ocr = { model, skippedPages }
```

- **New module `common/knowledge/pdfOcr.ts`** — page classification + image extraction + the VLM call (injectable `fetchImpl`, the `visionCore` pattern; reuse its data-URL helper). `pdfjs` stays confined to `pdfExtract.ts`; `pdfOcr` gets the page image through a function exported from there (`extractPageImage(data, pageNumber, deps?)`), keeping one pdfjs importer.
- **`sharp` is imported lazily** inside `pdfOcr` (`await import`), same rationale as pdfjs: main-bundle externalization, and it must never enter the MCP-subprocess bundle (verify: grep the built `builtin-mcp-knowledge.js` for `sharp`, as Stream A did for pdfjs).
- **Serialization stands:** one VLM call at a time, inside the existing per-project queue. 50 pages ≈ 50 calls ≈ minutes — which is exactly why Stream A's progress plumbing exists.
- **Source bytes (verified against post-D `sprint1`):** `processPending(projectId, workspace)` already reads `path.join(knowledgeDirOf(workspace), path.basename(source.fileName))` into `buffer` before the extension switch. The OCR branch reuses that same `buffer` — **no new read path, no store snapshot** (D removed snapshots; `converted.md` is the only per-source store file now). Do not reintroduce a snapshot read.
- **Respect D's `folderMissing` contract:** a *folder-level* failure leaves every remaining row `indexing` and sets `manifest.folderMissing`, deliberately not failing sources one by one. OCR failures are **per-source**, never folder-level — never set `folderMissing` from this code path, or a transient VLM outage will masquerade as a missing knowledge folder.

## 4a. `.text/` materialization — ⛔ NOT YOURS. ALREADY IN FLIGHT ELSEWHERE.

**CORRECTION (2026-07-30) — supersedes the earlier text of this section, which was wrong.**

An earlier draft assigned `.text/<fileName>.md` materialization to this stream, on the grounds it was "absent from Stream D's merge". That check was faulty: it inspected only merged history and missed an **active branch**. The work is being built right now on `feat/kb-extracted-text` (worktree `WePrompt-kb-folder`), which already carries `EXTRACTED_TEXT_DIR_NAME = '.text'` in `common/knowledge/constants.ts`, edits to `projectKnowledgeService.ts` and `builtinMcp/knowledgeServer.ts`, and `tests/unit/knowledge/extractedText.test.ts`.

**Do not implement any part of it.** Specifically, this stream must NOT:
- create or write a `.text/` directory, nor add `EXTRACTED_TEXT_DIR_NAME`-style constants;
- modify `builtinMcp/knowledgeServer.ts` — the search tool description belongs to that branch;
- add tests around extracted-text materialization.

**What this means for OCR:** transcribed markdown flows through the *existing* `converted.md` path, exactly as text-layer PDFs do today. Because the other branch materializes from that same conversion output, OCR'd documents become agent-readable **for free** once it merges. Staying out of its way is the whole coordination requirement.

**Overlap that IS expected:** you will both touch `projectKnowledgeService.ts` — it is a large file and that is fine. Keep your edits inside the PDF/OCR branch of `processPending` and the OCR helpers. **Stop and report** if you find yourself needing to change how `converted.md` is produced, or where source text is published — that is the other branch's territory, not yours.

## 5. Model resolution — `resolveOcrModel(providers)`

Mirror `embedProviderPicker.ts` (same file layout, same tests style):
1. Filter usable providers (`base_url` + `api_key`).
2. Prefer a model with a **vision capability** signal via `hasSpecificModelCapability(provider, model, 'vision')` — check what capability tags actually exist before coding; if there is no vision tag in the capability system, fall back to a conservative allowlist of known-multimodal model-id patterns (`gemma-4`, `kimi-k`, `gpt-4o`, `gemini`, `seed-1-6`, …) — **as a pattern list constant, not a single pinned id**.
3. **Probe before trusting** (entitlement ≠ catalogue, §2c): one cheap `max_tokens: 4` text-only call at ingest time; 404/403 → next candidate. Cache the resolved model per ingest run, not persistently — entitlements shift.
4. Nothing resolves → the source fails with a message that names the problem («no vision-capable model configured/entitled»), the same honesty contract as `SCANNED_PDF_ERROR` today.

Pin the model used into the source's provenance (§6), **not** into the manifest's embedding-style global pin — OCR quality may differ per document and re-OCR must stay possible.

## 6. Hallucination + provenance controls (non-negotiable)

A VLM can transcribe text that isn't there — worse than garbled OCR because it reads as confident. Controls:

- `temperature: 0`; prompt (keep as a named constant, English): *"Transcribe ALL text on this scanned document page into markdown. Preserve headings, lists and tables. Output only the transcription — no commentary. If the page has no legible text, output nothing."* Empty/whitespace answer ⇒ treat the page as skipped, never invent a placeholder.
- **Manifest provenance:** `source.ocr?: { model: string; skippedPages: number[] }`. Surfaced in the DTO.
- **Card:** OCR'd sources get a visible marker (tooltip listing model + skipped pages). i18n keys: `knowledgeOcrTag` («Transcribed (OCR)»), `knowledgeOcrDetail` («Transcribed from a scan by {{model}}. Pages skipped: {{pages}}») — all 12 locales.
- **Search-result rendering is unchanged** — chunks are chunks — but the sourceName citation plus the card marker keeps provenance one hover away.
- Progress: add `'transcribing'` to `KnowledgeIngestStage`; card label `knowledgeProgressTranscribing` («Transcribing page {{done}}/{{total}}»). Reuses the exact plumbing Stream A built; emit per page.

## 7. Cost honesty

OCR burns the **user's own provider quota** (~50 multimodal calls for a capped doc), unlike IDP's vendor-scoped key. v1 ships without a confirmation dialog (adding one is UX scope-creep beyond this stream) but the coordination doc's deferred item 2 (key handling) gains weight. Record actual tokens/latency for a full 50-page run during live verification and put the numbers in the MR — this is the datum a later "ask before OCR-ing" decision needs.

## 8. Testing

`tests/unit/knowledge/` conventions (temp stores, injected fakes). Fixtures: keep tiny —
- rotated flatbed fixture (generate with PyMuPDF: one page-filling raster, `/Rotate 270`),
- composite fixture (two small images on one page),
- reuse `image-only.pdf` (flatbed) and `text-layer.pdf` (must never trigger OCR).

Cover: routing (text-layer never calls OCR fake — the cost-model assertion, as in Stream A); classification (flatbed vs composite vs kind-1 → skip); rotation applied; empty transcription ⇒ skipped page; skipped-pages note + `ocr` provenance in manifest/DTO; all-skipped ⇒ failed; model resolution (capability hit, probe 404 → next, none → fail); progress events; i18n via check-i18n.

Also mandatory:
- **OCR failure must not set `folderMissing`** — a fake VLM that throws leaves the source `failed` and the manifest flag untouched. This one guards a genuinely misleading UI state.

## 9. Live verification (required; green tests are not evidence — Stream A caught a unit-tested-but-unreachable UI state only live)

1. Flatbed Vietnamese contract → transcribes, indexes, **chat cites it**; inspect `converted.md` — readable markdown.
2. The rotated HR doc → correct orientation (this is the fixture-vs-reality check for the sharp rotation direction).
3. The GWS composite → per-page skips with note, not a hard fail... unless *all* pages skip, then failed with reason.
4. No vision model entitled (temporarily break the key) → actionable failure message.
5. Record cost/latency for one 50-page run (§7).

## 10. Sequencing — cleared, with the post-D delta recorded (verified 2026-07-30)

**The block is lifted.** Verified against `origin/sprint1` (tip `c279f9c39`):

| Stream | State |
| --- | --- |
| **D** — Knowledge-Base folder | ✅ merged `e9f676867`, plus a PDF-preview fix on top |
| **B** — eval harness | ✅ merged (rebased to a new SHA, so the original `3456b837d` is *not* an ancestor — check for `tests/eval/` + the `eval:kb` script, not the SHA) |
| **A** — PDF ingestion + page-span fix | ✅ merged (`4cf691582`, and !9) |

**What D changed that this spec depends on — all re-verified, none breaking:**

- **The OCR hook point survived D's rewrite verbatim.** `if (!extraction.hasTextLayer) throw new Error(SCANNED_PDF_ERROR)` still sits in the `extension === 'pdf'` branch of `processPending`. D rewrote ~450 lines of that service and ~260 of the card, so this was the real risk; it did not materialize.
- `processPending` now takes `(projectId, workspace)`; bytes come from the workspace folder (§4). Snapshots are gone.
- New `common/knowledge/constants.ts` exports `KNOWLEDGE_FOLDER_NAME = 'Knowledge Base'` (deliberately unlocalised) — use it, never a literal.
- `manifest.folderMissing` and the leave-rows-`indexing` guard now exist (§4).
- `getSourceText` IPC exists for the in-app preview — **not** a substitute for `.text/` (§4a).

**Now-live contention to respect:** the extraction-quality follow-up is unblocked (B landed) and touches the same service file. Order decided in §3: E first. Do not run them in parallel.

**Still open, and it changes nothing here:** Issue #1 (IDP tenant/entitlement). Even if answered, IDP remains the wrong output shape (§1.2). Independently, post the §2c entitlement finding as a comment on Issue #1 — it reframes that issue from "stale URL" to "narrowly-entitled account", which changes who can resolve it.

**New leverage this stream did not have when first written:** the eval harness is now in `sprint1`. OCR'd Vietnamese scans are exactly the cross-language retrieval case B measured as the embedding half's main value (BM25-only caps at recall 0.870, and its 3 unreachable questions are 1 semantic-only + 2 cross-language). Consider adding an OCR-derived fixture case and re-running `bun run eval:kb` so OCR quality is *measured* rather than eyeballed — but per B's own discipline, do not change the instrument and the measured thing in one commit.

## 11. v2 sketch (separate design when justified)

Composite pages need true rasterization. In Electron the least-bad path is **not** node-canvas (native dep, asar pain): render pdfjs onto a real canvas in a hidden offscreen `BrowserWindow` and `capturePage()` — zero new npm deps, but new main-process machinery (window lifecycle, IPC, timeouts) deserving its own spec. Only worth it if census-class-2 documents turn out to matter to real users; the per-page skip notes from v1 are the signal to watch.
