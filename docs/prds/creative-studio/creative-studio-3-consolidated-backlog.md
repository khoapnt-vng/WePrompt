# Creative Studio 3 — consolidated backlog

Current as of 2026-09-04. Counts are derived from
`creative-studio-3-bug-list.md`; rejected intake items are not counted as bugs.

**129 bugs filed · 127 closed · 2 open** — 1 P1, 1 P2, 0 P3.

The divergent CS4 register used BUG-179 through BUG-195 after the CS3 rollback. Two older CS3
defects lost by that rollback are restored as BUG-200 and BUG-201 rather than reusing colliding ids.
BUG-202 records a live late-CS3 scalability failure and the bounded recovery behavior that keeps it
closed without importing the absent audio-analysis feature slice. BUG-204, BUG-205, BUG-207 and
BUG-208 reconcile Claude's follow-up findings against the recovery's actual contracts; proposed
BUG-206 is the same incident as BUG-207, and non-reproducing BUG-209 remains outside the bug count.
BUG-210 records the remaining visible-ID seam after restoring plain-language Director replies.
BUG-212 closes the one confirmed defect in Claude's later intake: an exact terminal video-refusal
code reached sanitized diagnostics but not the durable job result. Proposed BUG-211, BUG-213 and
BUG-214 are corrected product or terminology questions and remain outside the bug count.

---

## 1. Open bugs

| Bug         | Priority | State          | Remaining gate                                                                                                                                                                                      |
| ----------- | -------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BUG-144** | P1       | Owner-deferred | Approve and package distributable LGPL-compatible ffmpeg/ffprobe binaries; finish provenance, signing, notices and legal review; separately give found-but-unsupported builds accurate remediation. |
| **BUG-210** | P2       | Partial fix    | Carry the selected proposal through a typed backend-supported per-turn context so the editable draft and transcript no longer need the opaque routing ID.                                           |

There is no actionable open P3 queue.

### BUG-144 — distribution decision and capability copy

The resolver already supports an atomic bundled pair under
`resourcesPath/bundled-ffmpeg/<platform>-<arch>`, with environment and `PATH` fallbacks. The product
still ships no binaries, so its main distribution gate remains deferred by the owner and cannot close
through application code alone. Separately, the truly missing-binary path is actionable, but a pair
that is found and fails the capability probe is still misreported as missing; that copy split remains
bounded code work and does not solve the distribution gate.

### BUG-210 — the reply is plain; the selected-proposal handoff is not yet hidden

Commit `1accb3527` restores the Director's plain-language contract, removes proposal IDs from cards and
tool summaries, and keeps exact routing in strict structured MCP output. The remaining **Prepare updated
proposal** path has only one string shared by the visible editor, persisted queue and model request. The
current AionCore does not consume a one-shot hidden context field, so simply deleting the ID would make
multiple pending proposals ambiguous. Closure requires a typed proposal target that survives edits,
queueing and reload, is validated against the exact Studio project/conversation, and reaches the model
without entering visible draft or transcript text.

## 2. Closed in this recovery

- **Already present at the recovery base, ledger corrected:** BUG-141, BUG-142, BUG-160, BUG-161 and
  BUG-167.
- **First-run and framing repairs:** BUG-172, BUG-178, BUG-196 and BUG-197.
- **Current backport set:** BUG-162, BUG-171, BUG-173, BUG-174, BUG-175, BUG-176 and BUG-177.
- **Lost rollback regressions restored under fresh ids:** BUG-200 isolates unreadable project ledgers;
  BUG-201 keeps the viewer counter clear of Arco's close button.
- **Large-project preview scalability:** BUG-202 preserves active Beat/Cut playback through operational
  refreshes, bounds Board poster probing to one visible fair lease, suspends background probes during
  focused review, and releases hidden or detached media work completely.
- **Follow-up correctness and usability:** BUG-204 makes scripted-only Shot deletion reviewable while
  retaining every paid/derived dependency guard; BUG-205 blocks zero-capacity reference work through
  renderer, spend and live Director authority; BUG-207 surfaces the required human seed pin without
  changing BUG-115's contract; BUG-208 gives malformed requests, media, composition, storage and
  missing artifacts distinct safe outcomes.
- **Frame-aware chained generation:** BUG-165 makes ordinary Film generation sequential at unresolved
  predecessor-frame boundaries, adds exact-frame Director review, presents resolved chained video as
  `X–2X`, and authorizes exactly one receipt-free remote-failure retry without changing legacy,
  continuity-change or Board-promotion graphs.
- **Terminal video-refusal classification:** BUG-212 carries an exact allowlisted safety refusal from
  a successful terminal response into the durable result, while preserving status-first HTTP
  authority, honest `unknown` outcomes and the existing bounded retry contract.
- **Current-head Electron closures:** BUG-163 preserves the same stale-bound Director conversation,
  history, claimant and project binding through its one-time rules repair, then reattaches on a second
  restart without another write. BUG-166 captures a non-flat varied-video poster, persists the
  manifest-matched PNG, paints it after reload and creates no duplicate thumbnail. Both live passes
  used disposable profiles and made no paid provider request.

The current backports preserve the corrected versions of the historical fixes: BUG-176 lifts each
Shot tile rather than the entire Shot grid above the card overlay, and BUG-177 includes the viewer
counter follow-up found during live verification.

Implementation commit `d0ad3927d` closes BUG-162, BUG-171 and BUG-173 through BUG-177, restores
BUG-200 and BUG-201, and hardens BUG-166 before its current-head live closure. Its final affected-path
run passed 899 tests. The repository run passed 672 test files and 10,633 tests with 25 skipped; coverage passed at
72.73% statements, 70.96% branches, 69.94% functions and 74.65% lines. TypeScript, formatting,
translation validation and lint also pass; lint retains the repository's 1,324 warnings and has zero
errors.

Performance commit `bc9eac0aa` closes BUG-202 for the recovery line. Its four focused workspace suites
pass 350 tests, and the repository run passes 672 files and 10,647 tests with 25 skipped. TypeScript,
repository formatting, translation validation and lint pass; two independent read-only reviews found
no remaining correctness, lifecycle, race or usability issue.

Correctness commit `ffd58170a` closes BUG-204, BUG-205, BUG-207 and BUG-208. The final affected run
passes 15 files and 1,312 tests, including the real Director/reference lifecycle integration. The
Creative Studio coverage gate passes 672 files and 10,689 tests with 25 skipped at 87.92% statements,
85.25% branches, 91.56% functions and 91.25% lines. TypeScript, repository formatting, translation
validation and lint pass; lint retains 1,324 pre-existing warnings and zero errors. Independent reviews
found and then cleared the zero-capacity Director bypass and four export-classification/privacy edges.

Chained-generation commit `d5736033e` closes BUG-165. The focused BUG-165 run passes 792 tests; the
repository and Creative Studio coverage runs each pass 672 files and 10,702 tests with 25 skipped.
Coverage is 87.93% statements, 85.29% branches, 91.56% functions and 91.24% lines. TypeScript,
formatting, translation validation and lint pass with 1,321 repository warnings and zero errors. An
independent adversarial review found no remaining authorization, deadlock, exactly-once, reload,
cancellation-race or special-workflow issue after remote-attempt validation was hardened. No paid
provider generation was run during this code pass.

Director-language commit `1accb3527` completes the safe reply/card/tool-summary slice of BUG-210. Its
focused suites pass 428 tests, including the real MCP protocol boundary; the repository and coverage
runs each pass 672 files and 10,705 tests with 25 skipped. Changed source paths are at least 87.95%
line-covered. TypeScript, formatting, translation validation and lint pass with 1,321 repository warnings
and zero errors. The bug remains open only for the backend-supported hidden per-turn target described
above.

Terminal-refusal commit `09117688e` closes BUG-212 under its corrected scope. The adapter suite passes
45 tests, an independent adapter/job-manager review run passes 111, and the repository suite passes
672 files and 10,707 tests with 25 skipped. TypeScript, formatting and diff checks pass. Unknown
terminal responses stay unknown and use only the already-authorized bounded retry or a fresh reviewed
generation; the change does not broaden retry authority.

## 3. Planned product work outside the bug count

- **Sound:** make review audio audible, identify routes that cannot produce sound, include sound in
  shooting scripts, and defer music-bed import until an audio import route exists. Any restored Shot
  analysis must key work to asset identity/content hash, survive unrelated project revisions, retry
  stale reads only with a bound, and remain entirely outside the video-loading and transport gate.
- **Progressive work area:** derive readiness from status, provide a blank work area, disable empty
  views, advance on first content, then retire the References one-time transition.
- **Beat track:** the design decisions exist, but the work still needs slicing before implementation.
- **Board progressive monitoring:** decide whether a validated current panel should move into the
  large delivered-picture pane while a Shot has no take or pinned seed. Reuse one decoded image,
  preserve stale/pending authority, and label it as a board panel rather than delivered footage.
- **Director cleanup and remedy routing:** decide whether parking Beats emptied by a restructure should
  be proposal-only and human-reviewed, and whether project-status remedies need an explicit executor
  field that distinguishes undoable direct edits from operational recovery. Preserve intentional
  empty-Beat slates and do not widen the recovery tool to perform authoring mutations.

These plans are product work, not open defects, and must not be included in the bug totals above.
The proposed BUG-209 describes the absent audio-analysis implementation and is therefore represented by
the Sound constraint above rather than counted as a defect on this recovery.
