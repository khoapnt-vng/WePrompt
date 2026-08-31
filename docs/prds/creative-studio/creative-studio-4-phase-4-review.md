# Creative Studio 4 — phase 4 review

Reviewing `d00b40ce5` ("test(studio): prove phase 4 headless lifecycle") against its parent
`b8e0ecc82`, on branch `ghk/codex/creative-studio-4-pilot`. Read-only review; no code or plan changes
made. Six dimensions swept, every finding put to an adversarial verifier that re-opened its citations
independently — fifteen were refuted outright.

**Verdict: phase 4 is a real acceptance gate, not a suite that passes because of its own harness.**
No P1. One P2 — a behavioural regression in phase 4's own new runtime logic, not a test-honesty
failure. Six P3s. Of the eight scenarios the plan stakes the phase on, **six are proven sub-clause by
sub-clause and two are nominal on one clause each**.

**Nothing was executed.** No test run, no coverage run, no build. Every claim about pass/fail
behaviour, about the load-timeout prediction, and about whether the two new manifest files clear their
80% floors is derived from reading control flow, not from measurement.

---

## Why this is not the EPIC-002 shape

The review was designed to find fixtures built from types instead of the wire, and scenarios the plan
claims that are asserted vacuously. Largely it is not there, and the evidence is specific.

- **The resolver prohibition is honoured on both halves, not one.** `harness.ts:333` constructs the
  real `createStudioProviderResolver`, and feeds it at exactly the two seams production feeds —
  `listProviders`/`listConnections` returning the shipped fake bundle's own records
  (`harness.ts:321-332`), mirroring `runtime.ts:489-494`. Adapters are the real production registry
  merged with the fake (`harness.ts:334-335`). `resolveGeneratedUrl` is the real
  `createStudioPilotGeneratedUrlResolverV3` with only its declared `lookup`/`request`/
  `temporaryDirectory`/`createTemporaryId` seams doubled (`harness.ts:336-346`), leaving the SSRF
  check, size bound and header validation live. A real resolver fed hand-built provider records would
  have been half-compliance; this is not that.
- **Zero `vi.mock` anywhere under `tests/integration/creative-studio/pilot`.** The only
  `mockImplementation` calls (`generated-url-resolver.integration.test.ts:50,51,169`) wrap a _real_
  `node:fs` FileHandle at the resolver's declared fs seam. The single `vi.spyOn` in the phase-4 tree
  (`headless-recovery.integration.test.ts:358`) is observation only. Two stubbing spies exist at
  `entry-point.integration.test.ts:277,285`, both unchanged from `b8e0ecc82` — phase-3 code, not a
  phase-4 regression.
- **The post-intent failure arm is stronger than the plan required.** The harness ships a fault seam,
  `failMediaStepOnce`, with **zero call sites**. `headless-recovery.integration.test.ts:208-214`
  instead obstructs the real final path with `mkdir(finalPath)` — a genuine EISDIR publication refusal.
  The easy path was available and was not taken. No test writes a terminal Job; no test replaces the
  media resolver.
- **Scenario 8 follows the plan to the byte.** `headless-boundaries.integration.test.ts:187-189`
  asserts the copied capture is byte-identical to the committed schema-5 fixture, and `:191-196` proves
  the schema-6 corruption is exactly one field with `schemaVersion: 6` intact — the plan's "do not
  substitute minimal hand-authored JSON" instruction satisfied literally.
- **The 24-tests-for-8-scenarios ratio is honest.** `headless-lifecycle:179` is an `it.each` of 3,
  `headless-recovery:444` an `it.each` of 2, and the restart matrix maps one-to-one onto
  `resumePendingJobsV3`'s branch list (`jobs.ts:1101-1105`).

---

## The eight scenarios

| #   | Clause                                                                                                              | Verdict     |
| --- | ------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | create → prepare → quote → within-cap confirm → queued/running/succeeded → rename → undo → rename → reload → export | **PROVEN**  |
| 2   | no policy / over-cap / currency mismatch, no provider attempt before explicit confirmation                          | **PROVEN**  |
| 3   | import → rename → reload → export with no quote, authorization, Job, provider call or receipt                       | **PROVEN**  |
| 4   | ten named failure legs + restart in every nonterminal durable state                                                 | **NOMINAL** |
| 5   | stale / expired / duplicate confirmation and runtime-only revision movement                                         | **PROVEN**  |
| 6   | two projects, corrupt A's export catalog, restart, quarantine + rebuild, both operable                              | **NOMINAL** |
| 7   | concurrent create/import at 95→96, 97th produces no quote/authorization/Job/provider call/spend                     | **PROVEN**  |
| 8   | unsupported schema-5 deletion and quarantined schema-6 deletion                                                     | **PROVEN**  |

### Scenario 4 — the failing sub-clause is "timeout"

Nine of ten legs are proven. What is proven for "timeout" is the provider-_reported_ code
(`headless-recovery:108-116` scripts `{ kind: 'failed', code: 'timeout' }`) and the malformed-payload
route to `poll_deadline`. What is **not** proven, and structurally cannot be in this harness, is that
Main bounds a provider that simply never answers — the failure the new `hold` primitive was built to
model.

Both escapes are unreachable. `jobs.ts:523` measures against `nowEpochMs`, wired via
`runtimeFactory.ts:110-111` to `harness.ts:354`'s frozen `clock.now`, advanced exactly once in the whole
gate (`headless-lifecycle:286`) and never during a hold. `jobs.ts:531`'s `runWithProviderDeadline` uses
a real 60s `setTimeout` against a 10s suite ceiling.

A deterministic clock is what the plan's exit criterion mandates, so this is a scope gap rather than a
contract breach — but the plan lists "timeout" as a leg and only one of its two meanings is proven.
Closeable by advancing `clock` past `pollDeadlineMs`, or by injecting a small `pollAttemptTimeoutMs`;
`jobs.ts:110-113` already exposes both.

**The clause that sounds harder holds.** `TERMINAL_STATUSES` is `['succeeded','failed','cancelled']`
(`jobs.ts:44`), so the nonterminal set is exactly the five the matrix restarts in. A `download_failed`
Job is status `failed` — terminal by the code's own vocabulary — and the plan assigns its recovery to
`retryDownloadV3` by name, which `headless-recovery:186-266` drives.

### Scenario 6 — the failing sub-clause is "quarantine that catalog"

Four of five clauses are asserted strongly: `:69-71` startup catalog artifact ids, `:86` a full
deep-equal against the pre-corruption catalog, `:82-83` both projects load, `:92` project B's catalog
byte-unchanged.

The quarantine itself is proven only by
`readdir(exports/quarantine).some(e => e.startsWith('quarantine-'))`
(`headless-boundaries:72-73`). Nothing reads the quarantined bytes and nothing asserts a single entry —
while `export.ts:643/653/678/719` all mint that same prefix for pending markers, stage paths and
unverifiable piece directories. **Fix:** assert `toHaveLength(1)` and read the entry back, comparing to
the corrupt bytes written at `:63`.

---

## P1 — none

Stated explicitly because it is the question the review exists to answer. No defect was found on the
money, data, or remotely-supplied-URL surfaces, and each phase-3 guarantee was re-verified by reading
rather than trusted from the diffstat.

- **Exactly one `adapter.submit`** in the pilot tree (`jobs.ts:658`), gated on `!submitting.applied`
  first (`jobs.ts:655`) behind `status !== 'queued_local'` (`jobs.ts:647`). `'queued_local'` is written
  in exactly one place in the whole pilot tree — `confirmation.ts:293`, inside the authorized commit
  builder.
- **`confirmation.ts` is byte-identical** between `b8e0ecc82` and `d00b40ce5`. All four confirmation
  pins survive unchanged.
- **The media two-phase commit lost no step** on the new URL path; the download is a pre-step producing
  a path, cleaned in a `.finally` at `media.ts:1785`. Phase 4 _hardened_ this path — `media.ts:1671` now
  rejects a non-boolean `detectVariationGrid`, closing this repo's typed-boolean-lie class at that seam.
- **The durable-output cancellation fence is unchanged** — three `assertNoDurableGeneratedOutputClaim`
  gates (`jobs.ts:947/970/1017`), failing closed at `jobs.ts:243-248`.
- **The URL resolver delegates all network policy** to the hardened `downloadRemoteMedia` and chooses
  its strictest configuration: no `trustedPrivateGatewayOrigin`, no auth headers. **Zero
  provider-controlled bytes reach any filesystem path** — the temp name is
  `prefix + pid + id + '.part'`, the returned content-type is discarded, and content typing is sniffed
  from bytes at `media.ts:244`.

---

## P2 — one defect

### `recoverSameJob`'s new scheduler-tail join can hang a public resume for the full 30-minute poll deadline

Phase 4 deleted the O(1) refusal at `b8e0ecc82 jobs.ts:717`
(`if (active.has(key) || providerCancellationClaims.has(key)) throw 'busy'`) and replaced it with a
probe-join-reprobe at `d00b40ce5 jobs.ts:752-771`. The inline comment at `jobs.ts:762-764` states the
intent — join only a _"proven terminal/actionable tail"_ that _"may remain registered until the same
microtask unwinds"_. Nothing bounds the tail to an unwinding one, and the premise is false on one of the
two arms:

- **`kind: 'download'`** — the eligible durable state is `failed`, which **is** terminal, so a live
  flight really can only be an unwinding tail. The comment holds.
- **`kind: 'poll'`** — the eligible durable state is `needs_attention` + `poll_deadline`
  (`jobs.ts:741-745`), which is **not** terminal and which `runJob` deliberately re-polls
  (`jobs.ts:643-645`, routing straight into `pollRemote` with no durable write first).

That state is reachable and long-lived. `jobs.ts:1101-1105` schedules any
`needs_attention`/`poll_deadline`/`providerJobId !== null` Job at startup. `pollRemote`'s progress
mutations both return `false` unless the durable status is already `queued_remote`/`running`
(`jobs.ts:551`, `:561-563`), so the on-disk status, error code, `providerSubmissionKind`,
`providerJobId`, `remoteStartedAt` and revision all stay exactly as `loadEligibleCandidate` requires for
the entire loop — bounded only by `pollDeadlineMs`, default `30 * 60_000` (`jobs.ts:260`).
`projections.ts:285-290` returns `canResumeJob: true` throughout, so the renderer keeps offering Resume.

**Failure scenario.** Main restarts holding a Piece Job in `needs_attention`/`poll_deadline`. `startV3`
→ `resumePendingJobsV3` silently schedules it; `pollRemote` begins polling and writes nothing while the
provider answers `queued`. The user sees an enabled Resume button and clicks it. `resumeJobV3` →
`recoverSameJob` finds the active tail, the eligibility probe _passes_, and the call sits on
`await schedulerTail` (`jobs.ts:765`) for up to 30 minutes. When it finally resumes, the re-probe at
`jobs.ts:768` throws `stale_project` or `job_ineligible`. The user waited half an hour for an error
instead of getting `busy` in milliseconds.

**Why the gate cannot see it.** `harness.ts:356-360` injects `sleep` as a microtask, collapsing the poll
loop; `headless-recovery:481-513` exercises restart-resume without ever issuing a concurrent
`resumeJobV3`. The one test the commit added for the join (`jobs.integration.test.ts`, "joins an
already-actionable scheduler tail") gates the `download` arm, where the premise is sound.

**Smallest fix.** Restrict the join to the arm whose eligible state is terminal:

```ts
const schedulerTail = kind === 'download' ? active.get(key) : undefined;
if (active.has(key) && schedulerTail === undefined) throw new CreativeStudioPilotServiceErrorV3('busy');
```

Or bound the wait: `await Promise.race([schedulerTail, deadline])` and throw `busy` on the deadline.

**Scope caveat, stated honestly.** There is no production caller of `createCreativeStudioPilotRuntimeV3`
yet, so "the user clicks Resume" needs the phase-5 renderer. The defect is nevertheless in phase 4's own
new code and reachable today through the public jobs API this gate itself drives.

**Also:** `jobs.ts:756` assigns `candidateJob` purely as an eligibility probe and `jobs.ts:768`
unconditionally overwrites it. Dead assignment, no runtime effect, but it obscures that the probe exists
only to choose between `busy` and the join.

---

## P3 — defects and weak gates

### 1. The entire gate has one photograph, so no byte assertion can distinguish one asset from another

`harness.ts:264` builds the import fixture from `STUDIO_E2E_FAKE_IMAGE_BASE64`; `e2eFakeAdapter.ts:58-60`
defines `IMAGE_BYTES` from the same constant and `:502-503` serves it as the managed_file output;
`harness.ts:343` returns that same buffer as the URL body. Every `enqueueImport` call site passes only
`fileName` (`boundaries:54,56,123,131`; `lifecycle:222`) — the `bytes`/`sourcePath` escape hatches at
`harness.ts:571-576` have **zero** call sites. So the four payload assertions (`lifecycle:148,260`;
`boundaries:91,112`) compare against one buffer, and generated and imported assets hash identically.

No live defect is masked — managed files are named `${assetId}.${ext}` and `export.ts:848-856`
re-verifies `asset.id` and `assetFacts`, so a wrong-project resolution fails loudly rather than
substituting bytes. What is real is that the production sha and assetFacts guards run against a
degenerate corpus, and the plan's "managed bytes / export payload" clause is proven weaker than it
reads. **Fix:** pass distinct `bytes` per `enqueueImport` and give the fake a second base64 constant.
Two-line change; the harness already supports it.

### 2. Two of the three new suites run at the 10s ceiling with a 10s internal budget

`vitest.config.ts:21` sets `testTimeout: 10000`. The phase-4 files land in the general parallel `node`
project (`include` at `:43`; they appear in none of the exclude lists at `:46-61`, none of
`creative-studio-timing` at `:85-96`, none of `io-heavy` at `:117-127`). `harness.ts:66` sets
`DEFAULT_TIMEOUT_MS = 10_000`, consumed by `waitForJob` (`:428`) and `waitForIdle` (`:450`), and no call
site passes `timeoutMs`. Only `headless-lifecycle:42` raises its ceiling (`{ timeout: 120_000 }`);
`headless-boundaries:172` raises only the 96-import test. `headless-recovery:44` and `:380` raise
nothing.

`vitest.config.ts:103-111` documents this exact class in the repo's own words, including _"Every one of
these has failed a gate run as a timeout while passing in isolation."_ The plan's exit criterion is
"passes repeatedly".

The deterministic half is worth more than the flake prediction: because the harness deadline starts
_after_ per-test setup while vitest's starts at test start, the harness budget is always ≥ the outer
ceiling in those files. `Timed out waiting for projected Job <id>` (`harness.ts:443`) and
`Timed out waiting for project <id> to become idle` (`:458`) can **never be emitted** there. A stall
reports a bare vitest timeout naming no transition. **Fix:** `describe(..., { timeout: 120_000 })` on
both `headless-recovery` describes and `headless-boundaries:49`, exactly as `headless-lifecycle:42`
already does.

### 3. Dead `closed` variable in the new resolver, on a file that just joined an 80%-branch floor

`generatedUrlResolver.ts:119` declares `let closed = false`; `:130` sets it immediately after
`await handle.close()` at `:129`; `:132` and the object literal at `:133-142` cannot throw. So the catch
at `:143` is only ever entered with `closed === false`, and the false arm of `if (!closed)` at `:144` is
unreachable **by any program**, not merely by any test. The variable guards nothing. Behaviour is
correct today; delete the variable and the guard.

The `?? createNodeRemoteMediaRequest(120_000)` default at `:93` is likewise never executed — the one
test that omits every other dep still passes `{ request }` (`generated-url-resolver:250`). The file is in
`creativeStudioRuntimeManifest` (`vitest.creative-studio-coverage.config.ts:84`) under
`perFile: true, lines: 80, branches: 80`. Coverage was not run, so the threshold risk is reasoned rather
than measured; the deadness of `closed` is certain from control flow.

### 4. Scenario 6's quarantine clause is proven by a filename prefix only

See the scenario table above. **Fix:** assert `toHaveLength(1)` and read the entry back.

### 5. The composed cleanup contract is asserted only in halves, never together

Changing the resolver's return from `{path}` to `{path, cleanup}` (`media.ts:1521-1552`, wired via
`.finally()` at `media.ts:1785`) is the central contract change this commit makes at the media boundary.
The harness gives the real resolver a real sandbox directory (`harness.ts:257,261,337`) with **no** `fs`
override, so real bytes land there — but `downloadsDirectory` has zero references in any of the four
test files, and `harness.cleanup()` (`:666-675`) `rm -rf`s the sandbox unexamined. The halves are proven
separately: `generated-url-resolver:76-101` proves the real cleanup is idempotent but calls it by hand;
`media.integration.test.ts:1396,1436` proves the store calls cleanup twice and three times but against a
`vi.fn`. `headless-recovery:133-184` runs the real `kind:'url'` arm end to end through the real store and
asserts nothing about the temp directory.

### 6. Process: the contract was amended inside the commit that claims to satisfy it

The plan diff rewrites the download-arm paragraph and splits scenario 4's "download failure" into two
named modes (plan `:712-716`, `:726-728`).

**The direction is a strengthening**, and the old sentence was verified factually unsatisfiable on this
code: `media.ts:1629` calls `resolveGeneratedSource` _before_ `withRecoveredProjectAuthority`, and
durable `download_failed` is only written from inside the intent-recovery path (`media.ts:1012-1018`), so
a pure failing URL download could never have produced the old clause's `download_failed`. Both new
obligations are implemented and both are met.

Recorded anyway, because a contract edited in the same commit that claims to satisfy it is exactly the
shape a _weakened_ gate would take, and a reviewer diffing only code would not see it. This is the second
consecutive phase to do it. If the next amendment is a genuine weakening, this workflow passes it through
identically.

---

## Untested — gaps in what the gate exercises, not bugs in shipped code

1. **Main bounding a hung provider** — see scenario 4.
2. **Route selection and `route_unavailable`.** `harness.ts:325-332` filters `listConnections` to one
   binding; the shipped lifecycle profile ships three (`e2eFakeAdapter.ts:824,843,861`), including a
   second image binding on the same adapter, and production does not filter (`runtime.ts:489-494`).
   `pricing.ts:46` selects with `.find()` — first eligible route wins — so ordering and tie-break are
   never exercised, and the no-configured-provider path has no coverage. Restoring the second image
   binding costs nothing.
3. **Duplicate-charge acknowledgement.** `harness.ts:562-563` auto-echoes the flag from the quote and no
   phase-4 test pins it. Covered outside the gate at
   `preparation-confirmation.integration.test.ts:811-843` and `jobs.integration.test.ts:767-793`.
4. **Export CAS.** `harness.ts:588-596` reads the revisions immediately before passing them, so no
   phase-4 test can produce a mismatch through `harness.exportPiece`. The plan does not assign export CAS
   to this gate.
5. **Persisted `undoHistory`** is never read back from `project.json` by a Pilot integration test.
   Near-empty in practice — `pilotStore.ts:1341` re-reads the manifest on every authority acquisition, so
   the undo at `headless-lifecycle:130` succeeds only if the entry was durably persisted under exactly
   that id.
6. **No phase-4 restart occurs while a durable media intent exists** — both restart tests use detached
   peers. Covered outside the gate at `media.integration.test.ts:1136-1192` and `:1089-1134`.
7. **Temp-download reclamation.** `generatedUrlResolver.ts:107-110` writes into `os.tmpdir()` by default
   with no sweeper; startup recovery (`entryPoint.ts:357-360`) is project-scoped. Unreachable today —
   there is no production caller — and the filename comment at `:115` shows the author reasoned about
   foreign files deliberately. **Forward note for phase 5**, not a defect here.
8. **`e2eFakeAdapter` capability divergence from CS3.** The resolver drops `trustedPrivateGatewayOrigin`
   and OpenRouter auth headers that `jobManager.ts:283-301` carries. Unreachable: the Pilot is image-only
   and every production URL emitter is video-gated. `generatedUrlResolver.ts:82-86` documents the
   narrower scope on purpose. Becomes live if the Pilot gains a video route.

### Latent and unreachable — record, do not fix under time pressure

- **Intent-id validator decoupling.** Phase 4 moved both intent-id mints from `temporaryId()` to
  `durableIdentity('media_intent')` (`media.ts:1415,1647`). `durableIdentity` validates with `SAFE_ID`
  `{1,256}` (`media.ts:47,727`); `parseIntent` reads back with `SAFE_TEMPORARY_ID` `{8,128}`
  (`media.ts:48,427`). Before phase 4 both ends shared one regex. An injected `mintIdentity` returning a
  1–7 character id would mint fine and be quarantined on read (`media.ts:1143-1149`), leaking the staged
  bytes past the sweeper's own filter (`media.ts:1167`). No caller can supply that today — production
  yields 37 characters, the harness 21 — but the invariant that made it impossible is gone. One-line
  fix: validate `media_intent` with `SAFE_TEMPORARY_ID`.
- **Peer `dispose()` deletes a shared fixture directory.** `e2eFakeAdapter.ts:959-963` always `rm -rf`s
  `fixtureDirectory` (derived from the shared `rootDir`, `:319-320`) even when `ownsRemoteState` is
  false, and `headless-recovery:369-372` disposes the peer _before_ releasing a paused primary. It
  already deletes `fake-image.png` out from under a live runtime today; it is harmless only because
  every `storageStep` emission follows `copySourceToStage`, so no pause point exists at which the bytes
  have not been copied. A bundle should not `rm` a directory it does not exclusively own.
- **`recordPaidOutputOutcome` discards `applied`** (`jobs.ts:414`, callers at `:492,504,509`) and its
  `ownsCompletion` guard excludes `'cancelled'` (`:418-430`), so a job another Main committed as
  cancelled silently drops its receipt. Needs two concurrent Mains on one store. **Pre-existing phase-3
  condition** — `jobs.ts:408-513` is byte-identical to `b8e0ecc82`.
- **Cosmetic:** `harness.ts:648-649` defines `persistedQuotes` as the identical expression to
  `authorizations`, and both are asserted side by side. Delete it or give it an independent definition.
- **Naming:** `generated-url-resolver:103-117` is titled "preserves the bounded downloader size refusal"
  but supplies an empty body with an oversized `content-length`, exercising only the header pre-check.
  Streaming enforcement is covered a layer down at `remoteMediaDownloader.test.ts:204`.

---

## Correctly deferred to phase 5 — not findings

The plan assigns these in writing (plan `:745-749`): real native import/save dialogs, project-menu
initiation, reveal-in-folder. A grep of the phase-4 tree for
`dialog|showItemInFolder|reveal|projectMenu|shell\.` returns **zero hits** — nothing is silently
claimed. The picker is injected at the plan-authorized Main seam (`harness.ts:352`) and the exporter is
driven through the public entry point.

One forward item belongs to phase 5 rather than here: **`undoEntryId` is the only channel through which
an undo entry id ever reaches a caller.** It is returned in-memory from `applyMutationBatchV3`
(`entryPoint.ts:297`), appears in no V3 projection, and `applyUndo` requires an exact top-entry match
(`pieceCatalogV3.ts:340-345`). So undo is unavailable after a reload until phase 5 adds a projection —
which plan `:530` pre-authorizes as "a reviewed UI requirement". Note phase 4 _improved_ this: at
`b8e0ecc82` the entry point returned no `mutationId` at all, making `undo_last` unreachable through the
public path entirely.

---

## Refuted — do not act on these

1. **"Scenario 4 skips the nonterminal durable state holding paid staged bytes."** `download_failed` is
   status `failed`, terminal per `jobs.ts:44` / `entryPoint.ts:94`. The plan assigns that state to
   `retryDownloadV3` by name, which the test drives.
2. **"The rate/route join has no wire evidence."** `quote` is a required non-nullable member of
   `StudioPieceSpendAuthorizationV3` (`creativeStudioTypes.ts:1791`) and `readProjectManifest` validates
   before counting; the proposed "faithful" filter is unwritable.
3. **"The confirmation echo means the gates cannot fire."** `quote.requiresExplicitHumanAction` is a
   _prepare-time_ projection while `confirmation.ts:246-258` re-derives from the live policy at confirm
   time, so echoing is a real prepare-vs-confirm cross-check.
4. **"The no-op sleep leaves a livelock trap."** Every enqueued script's final `pollStep` is terminal or
   a hold; no caller can supply the triggering input.
5. **"`temporaryDirectory.includes('\0')` is an uncovered branch."** Under v8 range coverage the operand
   is evaluated in seven of eight tests.
6. **"A wrong-project export would pass the byte assertion."** Managed files are `${assetId}.${ext}` and
   `export.ts:848-856` re-verifies the asset id and facts. Only the degenerate-corpus half survives, as
   P3 #1.
7. **"The script queue fails open silently."** Resubmissions replay through `submissionOutcomes`
   (`e2eFakeAdapter.ts:672-688`) before reaching `nextTaskScript()`, each test builds its own
   `remoteState`, and every scripted test pins exact provider counters.
8. **"Phase 4 widened the `recordPaidOutputOutcome` no-op window."** `jobs.ts:408-513` is byte-identical
   to the parent.
9. **"The one `mutateJob` site that ignores `applied`."** There are eight sites, four of which discard
   the result.
10. **"The peer adds a third fixture file at `harness.ts:506`."** **Fabricated citation** —
    `harness.ts:506` is `if (disposed) return;`. The `fake-variation-grid.png` literal is
    `e2eFakeAdapter.ts:507`, produced by a script that creates no detached runtime.
11. **"The resolver's flat 120s deadline should use `resolveRemoteMediaBudget`."** With no `byteSize`
    that call returns 120_000 identically (`remoteMediaBudget.ts:22-23`); the proposed fix is a provable
    no-op.
12. **"Orphaned temp downloads accumulate 50 MiB per crash."** No production caller exists; every test
    injects a sandbox directory.
13. **"`undoEntryId` ordering makes the gate blind."** Plan `:721` specifies the
    `rename → undo → rename → reload` order; following the frozen contract is not blindness.
14. **"A frozen type was widened with no authorizing plan text."** Scenario 1 mandates undo, undo needs
    the exact entry id, no projection carries it; the frozen _parser_ keys are untouched and
    `StudioMutationApplyResultV3.result` was already unused at `b8e0ecc82`. Survives only as an imprecise
    doc comment at `creativeStudioTypes.ts:2062`.
15. **"`pieceCatalogV3.test.ts` never asserts `undoHistory`."** It does, at `:180`, `:199-205`, `:218`
    and `:267`, and `:222-244` blocks the hypothesised parser relaxation loudly.

---

## Unverified — stated, not dropped

The adversarial verifier hit its budget before adjudicating these four. Treat as unadjudicated leads.

- A second same-key submitter can be handed a `providerJobId` before `remoteState.tasks.set` runs
  (`e2eFakeAdapter.ts:689-701` vs `:740`). Claimed unreachable today; not confirmed.
- Roughly a third of the harness surface is unused (`failMediaStepOnce`, `mediaSteps`, `waitForIdle`,
  `identityCounts`, `releaseSubmitHold`, `rootDir`, `sandbox`, the import-selection escape hatches).
  Counted in one sweep, not re-counted.
- `readProjectManifest` (`harness.ts:461-474`) re-implements the brief envelope decode and skips the
  digest check `pilotStore.ts:349-362` enforces. Claimed covered incidentally; not confirmed.
- **Whether `generatedUrlResolver.ts` and `e2eFakeAdapter.ts` clear the per-file 80% lines and branches
  floor. Nobody measured this.** Both estimates read as comfortable, but they are estimates.

---

## What this review did not cover

**Nothing was executed.** No test run, no coverage run, no build — the target commit was not checked out
while the review ran, so even a single-file run would have required a state-changing checkout. Every
claim about pass/fail behaviour, about the load-timeout prediction, and about the two 80% thresholds is
derived from reading control flow.

Read in full at `d00b40ce5`: the plan's `### Phase 4` section and its diff; all four new phase-4 suites
and `harness.ts`; `generatedUrlResolver.ts`; `e2eFakeAdapter.ts`; the complete diffs of `jobs.ts`,
`media.ts`, `runtimeFactory.ts`, `entryPoint.ts`, `creativeStudioTypes.ts` and the coverage config. Read
in relevant part: `runtime.ts` provider wiring, `providerResolver.ts`, `pricing.ts`, `confirmation.ts`,
`prepare.ts`, `export.ts`, `projections.ts`, `pilotStore.ts`, `pieceCatalogV3.ts`,
`remoteMediaDownloader.ts`, `remoteMediaBudget.ts`, `jobManager.ts`, and both vitest configs.

Not reached: the ~540 added lines of `tests/unit/.../providerAdapters.test.ts` were read in one sweep but
not re-verified; the phase-4 extensions to the pre-existing `jobs`/`media`/`entry-point`/`runtime`
integration suites were sampled by targeted grep rather than read end to end; and no phase 1–3 code
outside the phase-4 diff was audited.
