# Stream B — Retrieval Evaluation Harness

**Date:** 2026-07-28
**Branch:** `feat/kb-eval-harness` off `feat/project-knowledge-base` (worktree `WePrompt-kb-eval`)
**Read first:** `2026-07-28-kb-followups-coordination.md`

## 1. Why

Every retrieval knob in the knowledge base is currently set by judgement, not evidence: chunk size (3,200 chars), overlap (400), candidates per list (30), RRF `k` (60), default `max_results` (6), the payload cap (12,000 chars). Nobody can answer *"did that change make retrieval better?"*

That matters immediately, because Stream A is about to feed the index a **new and much noisier class of content** — OCR'd scans, with broken line breaks, misrecognised characters, and no heading structure. That is precisely the kind of change that quietly degrades ranking. Without measurement it would land invisibly.

It also unblocks the deferred reranker: the reason the reranker was demoted is that at a 7-passage corpus there is no measurable headroom. A harness is what turns "should we add a reranker?" from opinion into a number.

**Build this early. It is small, and it makes everything after it safer.**

## 2. Shape

A **fixture-driven offline evaluator**, not a test that asserts fixed rankings.

```
fixture corpus (documents)  ─┐
                             ├─► build a real store in a temp dir
golden questions ────────────┘        │
   (question → expected source/chunk) │
                                      ▼
                            run searchKnowledge()
                                      │
                                      ▼
                    metrics: recall@k, MRR, per-question detail
```

Reuse the real pipeline end to end — `chunkMarkdown` → `buildBm25Index` → (optional embeddings) → `searchKnowledge`. Do **not** reimplement retrieval in the harness; the point is to measure the shipping code.

### Metrics

- **Recall@k** (k = 1, 3, 6): is the expected source among the top k? The headline number.
- **MRR**: reciprocal rank of the first correct hit — catches "right answer, wrong position" that recall@6 would hide.
- **Per-question output**: question, expected, what actually came back, and the rank. Aggregates say *whether* something regressed; the detail says *what*.

Report BM25-only and hybrid **separately**. They fail differently, and the semantic half is optional at runtime, so a change that helps one can hurt the other.

## 3. The fixture is the actual work

The code is an afternoon. The fixture is the deliverable.

**Requirements:**

- **Vietnamese *and* English content, mixed.** Non-negotiable. The NFD-normalisation bug found during the build (decomposed Vietnamese diacritics shattered tokens and silently destroyed recall) is exactly the regression class only a Vietnamese fixture catches. Include both NFC and NFD-encoded text.
- **Realistic back-office documents** — the shape of things people will actually index: a policy memo, an invoice-like table, a meeting summary, a spec with nested headings.
- **~15–25 questions.** Enough to be informative, few enough to curate honestly.
- **Deliberately hard cases**, not just easy keyword hits:
  - a question whose wording shares *no* keywords with the answer passage (only semantic retrieval can win — this is the test that justifies embeddings at all)
  - a question whose answer straddles a chunk boundary (validates the 400-char overlap)
  - a distractor: two documents discussing the same topic where only one actually answers
  - an exact-identifier lookup (a code like `QUOKKA-7`, an invoice number) where BM25 should dominate
  - a question the corpus genuinely **cannot** answer — the correct behaviour is returning nothing useful, and a harness that never tests this rewards over-retrieval

**Privacy:** do not commit real VNG documents. Author synthetic ones in the same register. If real files are used for local exploration, keep them out of the repo.

## 4. Where it goes

Suggested `tests/eval/` — fixtures, the runner, and a golden-questions file (JSON or YAML: `{ question, expectedSource, expectedChunkHint?, notes }`).

**Deliberately not part of `bun run test`.** It needs network for embeddings and takes real time; wiring it into the default suite would make CI flaky and slow. Expose it as an explicit script (`bun run eval:kb` or a `just` recipe) that prints a table and exits non-zero on regression against a committed baseline.

The BM25-only path has no network dependency and **could** run in CI. Worth doing: it guards tokenisation and fusion regressions for free. Decide during implementation; if it goes into CI it must be fast and deterministic.

## 5. Design notes

- **Embeddings need a provider.** Read config the same way the service does (`listProviders` → `pickEmbeddingModel` → `resolveEmbedConfigForModel`). If no embedding model is configured, run BM25-only and **say so loudly in the output** rather than silently reporting half the picture.
- **Cache embeddings between runs** keyed by content hash. Without this, iterating on RRF `k` re-embeds the whole fixture every time — slow and needlessly billed.
- **Make the knobs parameters**, not constants, in the harness: chunk size, overlap, candidates-per-list, RRF k, top-k. The entire value is being able to sweep them and compare.
- **Commit a baseline** result file so a regression is a diff, not a memory test.

## 6. What good looks like

Running it prints something like:

```
BM25-only     recall@1 0.72  recall@3 0.88  recall@6 0.92  MRR 0.79
Hybrid        recall@1 0.84  recall@3 0.96  recall@6 1.00  MRR 0.89
  ↓ per-question failures
  [Q7]  "khi nào cần mã thông quan?"  expected policy-vn.md  got expense.md (rank 2)
```

Two things become answerable that are not today: *does the semantic half actually earn its cost?* and *did this change help?*

## 7. Scope guard

**In:** fixture corpus, golden questions, runner, metrics, baseline, script wiring, docs on how to add a case.

**Out:** changing retrieval behaviour. If the harness reveals a tuning win — different chunk size, different `k` — **record it and stop.** Acting on findings is separate work, deliberately, so the measurement instrument and the thing measured never change in the same commit.

**Coordination:** Stream A owns `projectKnowledgeService.ts` and the card. This stream should not need either — it can drive `chunkMarkdown`/`buildBm25Index`/`searchKnowledge` directly. If you find yourself needing to modify service code, stop and coordinate.
