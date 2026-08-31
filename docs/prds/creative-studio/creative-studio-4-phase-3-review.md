# Creative Studio 4 — phase 3 review

Reviewing `11c2b497b` ("feat(studio): implement schema-6 Pilot runtime") against its parent
`3d21ab873`, on branch `ghk/codex/creative-studio-4-pilot`. 68 files, +16,629 / −74: 36 source files
(+7,983), 28 test files (+8,581), one doc. Read-only review; no code or plan changes made.

**Verdict: no P1.** Two P2s, both verification holes on money-adjacent fences rather than defects;
eleven P3s; one process finding. Six dimensions were swept and every finding was put to an adversarial
verifier that re-opened its citations independently — four were refuted outright and nine downgraded.
Nothing was executed: no vitest run, no coverage run, no build.

**Read this before acting on anything below:** the "what this review did not cover" section is not
boilerplate. Roughly 1,180 of `jobs.integration.test.ts`'s 1,981 lines and ~900 of
`media.integration.test.ts`'s 1,433 were read as `it()` title lists plus sampled bodies.

---

## This is not the EPIC-002 failure mode

The review was designed to find green tests over a feature that had never worked, because that is this
project's defining failure — 8,200 passing tests while the feature was broken, five real defects hidden
behind fixtures built from types and schemas instead of the wire. That is not what this is, and the
evidence is specific:

- **Zero `vi.mock` calls in the entire phase-3 test tree.** `presentation/realFixture.ts` earns its
  name: it builds every piece of durable state exclusively through the public entry point
  (`createProjectV3` → `preparePhotoV3` → `confirmPreparedPhotoV3` → real jobs → real media) against a
  real temp filesystem with real `sharp`-encoded bytes. `store.integration.test.ts` asserts real
  persisted bytes and hostile raw JSON written to disk. `media.integration.test.ts` drives the real
  media store against real files, `realpath`, source-byte sha256, and `readdir` on `.parts`/`.intents`.
- **The durability code is the strongest in this repository.** The media path is a genuine two-phase
  commit: `open(...,'wx')` + `handle.sync()` → fsync parts dir → control record by
  write-temp/`link`/fsync-dir → final by `link`, never rename-over → re-read and verify sha256 +
  magic-byte MIME + dimensions → only then the project commit. `removeExactFile` refuses to delete a
  file whose sha does not match.
- **Spend safety is real and tested against durable absence.** Exactly one `adapter.submit` call site
  exists in the whole pilot tree (`runtime/jobs.ts:657`), reachable only after
  `assertConfirmationDecision`. Confirmation is triple-pinned: `authoringRevision` equality, a
  byte-for-byte canonical re-derivation of the quote from the _current_ project, and `expectedRevision`
  re-asserted on disk immediately before the replace. The expiry and policy-movement tests reload
  through a _fresh_ store and assert `spendAuthorizations` empty and `dispatch` not called.
- **The exact-key trap was handled, not tripped.** `JOB_KEYS_V3` was correctly extended with
  `providerSubmissionKind` and matches the writer literal in `confirmation.ts:288-319` key for key;
  `validateStudioProjectV3` runs on every durable write (`pilotStore.ts:978`), so writer/validator drift
  refuses loudly instead of persisting silently.
- **Completion-gate leg 7 was not missed.** `vitest.creative-studio-coverage.config.ts` gains 13
  `service/pilot/**` entries (lines 74-86), `store/pilotStore.ts` (line 98), and the `service/director/*`
  rename propagation (lines 38-42). Every listed path exists at `11c2b497b` and no pilot source file is
  absent from the manifest. That leg is unguarded — nothing fails if you skip it — which is exactly why
  it is worth saying it was done.

---

## P2 — two money-adjacent fences whose tests do not exercise them

### P2-1. The variation-grid detector has no positive test, and the composed runtime never takes its true branch

`imageHasVariationGrid` + `defaultDetectVariationGrid` (`runtime/media.ts:317-405`) is ~89 lines of
band-similarity/cosine heuristic that **is never asserted anywhere in the commit**. The only test-side
references are option declarations (`media.integration.test.ts:132, 151, 206, 292`) and one stub —
`detectVariationGrid: async () => true` at `:1303`. That test mocks the exact seam it appears to
exercise: it proves the plumbing from a `true` to `variation_grid` at `media.ts:1647-1648`, and nothing
about detection.

The real detector _does_ execute in the composed presentation fixtures — `CreativeStudioPilotRuntimeDepsV3`
(`runtimeFactory.ts:30-42`) has no `detectVariationGrid` hook, so `media.ts:709` always falls through to
`defaultDetectVariationGrid` there — but only over 32×24 solid-colour PNGs, where it returns `false`.

**Why it matters.** This is the fence for the seed-still grid defect: a provider returns a 2×2 variation
grid as one still, it becomes a Piece's current asset and then the conditioning frame for everything
downstream. If the heuristic breaks or is refactored, the failure is silent — no test turns red, and a
per-file 80% gate cannot see 89 uncovered lines inside an 1,819-line file.

**Smallest fix.** One unit test over `imageHasVariationGrid` with a synthesized 2×2 grid buffer (true)
and a synthesized single image (false). Call the pure function; do not route it through the media store.

**Same finding, second half.** `media.ts:140` declares `detectVariationGrid?: (filePath: string) =>
Promise<boolean>` and `:1647` gates on bare truthiness, so an injected implementation resolving
`undefined` reads as "not a grid" — fail-open polarity in front of a paid-output fence. Close it with
`=== true`.

### P2-2. The paid-output-vs-cancellation fence is only ever tested in halves

`cancelJobV3` refuses at `!canCancelProviderJob(job)` (`jobs.ts:897-899`) **before** the durable-claim
inspection at `jobs.ts:922`, and `canCancelProviderJob` (`jobs.ts:227-228`) returns false whenever
`job.spendReceipt !== null`.

The one composed test named for this fence — `runtime.integration.test.ts:400-555`, "keeps a durable
remote output claim ahead of cancellation across a Main restart" — asserts at `:513-520` that the
interrupted job carries `spendReceipt: { jobId: confirmed.jobId }`. So both the pre-restart refusal
(`:522-529`) and the post-restart refusal on a brand-new runtime (`:534-541`) are decided by the receipt
check, and `inspectGeneratedOutputClaimUnderAuthorityV3` is **never consulted**. Both assertions only
check that `adapter.cancel` was not called, which cannot distinguish the two refusal paths.

The jobs-side half is tested against a scripted double (`jobs.integration.test.ts:407-419`, asserting
`inspectOutputClaim: 1` at `:1506-1528` with `spendReceipt: null`); the media-side half against real
intent files (`media.integration.test.ts:759-902`). `runtimeFactory.ts:109-116` wires the real inspector
to the real cancel path — but no test reaches the inspector through that composition.

**Failure scenario.** The one production state where the inspector is the sole fence is a
**receipt-less** job with a durable generated intent — real process death inside
`publishGeneratedOutputV3` before `jobs.ts:440` persists the receipt. If drift makes the inspector answer
"clear" for such a job, cancellation deletes the only pointer to output the user has already paid for,
and all three existing test files stay green.

**Smallest fix.** One composed case: a receipt-less job with a durable generated intent, cancelled
through the real runtime after a restart, asserting `cancellation_refused` **and** that the inspector was
consulted.

**On rigour.** The sweep's proposed drift example — narrowing `media.ts:1266` to require `providerJobId`
equality — is refuted: `media.integration.test.ts:759-807` deliberately mutates the job to a drifted
`providerJobId` and still expects `'claimed'`, so that change turns red. The seam also fails closed on
inspector throws (`jobs.ts:243-248`). The hole is narrower than first claimed, and still worth one test.

---

## P3 — money and data first

**P3-1. One unreplayable generated intent wedges every media operation for the whole project.**
`media.ts:1141-1147` is the only sidelining path and fires only for parse-failed or foreign-project
records; an intent that _is_ owned but cannot be replayed goes to `recoverGeneratedIntent` and returns
`true` (`:1149-1156`) with no attempt counter and no quarantine. `recoverableIntentOwnsJob` keeps it
claimable forever once the job is `failed` + `download_failed` + non-null receipt, and `:1056-1063`
rethrows without marking. Every media entry point runs recovery first — `recoverProjectMediaV3:1281`,
`importPhotoV3:1399`, `publishGeneratedOutputV3:1608`, `verifyManagedAssetV3:1784`, all via
`withRecoveredProjectAuthority:1196-1216` — and `export.ts:848` calls `verifyManagedAssetV3`, so export
is affected too. `retryDownloadV3` has no escape (`jobs.ts:774` rethrows because the code is
`storage_error`, not `job_ineligible`). `media.integration.test.ts:1065-1110` constructs exactly this
state, asserts `storage_error`, and never checks that any _other_ media operation still works.

_Understated consequence:_ a **later** paid generation on the same project is also blocked at
publication, and `jobs.ts:499-504` then records its receipt — money spent, no publishable asset.
_Why P3:_ the in-app routes are closed (the part is fsynced before the intent is published, residue is
preserved on the publish catch), so it needs filesystem damage from outside the app to one specific file
while its sibling survives. **P2 is defensible if externally-damaged project media is in scope.**
_Fix:_ after the first unverifiable replay, rename the intent to `.invalid-*` exactly as `media.ts:1144`
does, confining the wedge to the one paid job.

**P3-2. `runJob` gates a paid call on observed status rather than on whether it won the transition.**
`mutateJob` returns the _observed_ project when its callback declines (`jobs.ts:298` throws
`JobTransitionSkipped(current)`, `:303` catches and returns `error.project`), so a skipped transition is
indistinguishable from a won one. `jobs.ts:654` then gates on
`submitting.jobs[jobId]?.status !== 'submitting'` and falls through to `adapter.submit` at `:657`. A
writer whose `inspectProject` read lands after the winner's commit never enters the CAS, gets
`JobTransitionSkipped`, and submits too — two charges against one authorization, with only one receipt
recordable (`job.spendReceipt ??=`, `jobs.ts:440`).

_Not reachable today:_ single-runtime is provably safe (`schedule`'s `active` guard at `jobs.ts:697/706`;
`:649` is the only writer of `'submitting'`; a disk-`submitting` job returns early at `:645`), there is
no production construction site, and `app.requestSingleInstanceLock` blocks two app instances. The
sweep's stated mechanism — "the CAS loser reloads and passes the gate" — is **wrong**: a CAS loser throws
`stale_project` and never submits.
_Fix:_ have `mutateJob` return `{ project, applied }` and gate `:654` on `applied === true`. **Do this
before phase 4/5 wires real callers.** `jobs.ts:680/879/1020` share the pattern but unlock only polling
and an idempotent cancel.

**P3-3. Two exact-key gates sit on injected boundaries whose producers do not exist yet.**
`media.ts:1525-1527` requires the download resolver to return _exactly_ `{path}`; `media.ts:637-653`
requires the native picker to return _exactly_ `{path, fileName}`. `hasExactKeys` is a length-plus-
membership check, so a superset is rejected, and TypeScript will not catch it for a value assembled in a
variable. A phase-4/5 downloader returning `{path, byteSize}` fails at `:1526` with `download_failed`
**after the provider has been paid** (`jobs.ts:453-473` has already claimed `paidOutputHandoffs`; the
throw lands in `recordPaidOutputOutcome`). The import failure code is `invalid_media`, not
`invalid_payload`. _Fix:_ narrow instead of reject, or name the offending key in the error.

**P3-4. One wire-invalid literal in `entry-point.integration.test.ts`.** `:436` builds
`cancel = {projectId, pieceId, jobId, expectedRevision: 6}` and `:445/:451` assert it resolves and was
delegated — but `CANCEL_PIECE_JOB_KEYS` is `{projectId, pieceId, jobId}` (`contracts.ts:39`) and
`snapshotExactRecord` rejects on length (`contracts.ts:71`), so the real parser at `jobs.ts:858` would
refuse it. `:444`'s `importPhotoV3({projectId})` omits the required `expectedAuthoringRevision`. Both
pass only because the harness stubs the delegates. _Not a false-green:_ the real shapes are pinned by
`contracts.integration.test.ts:86-95` and exercised through real code ~45 times. One wrong literal,
written by analogy to `resume` (which _does_ carry `expectedRevision`). _Fix:_ delete `expectedRevision`
from `:436`, add `expectedAuthoringRevision` at `:444`.

**P3-5. The jobs test's fake media publisher accepts publications the real store refuses.** Its remote
`ownsCompletion` (`jobs.integration.test.ts:257-259`) admits any `needs_attention` error code; the real
`assertGeneratedPublicationOwner` (`media.ts:1531-1562`) additionally requires `poll_deadline`, non-null
`remoteStartedAt`, `piece.jobIds.at(-1) === job.id`, `currentAssetId === null`, `outputAssetId === null`,
no existing generated asset for this job, and asset capacity. Latent — no current path publishes from a
looser state. _Fix:_ mirror the predicate in the double.

**P3-6. An assertion that cannot fail.** `contracts.integration.test.ts:254-259` declares
`const capacityCode: CreativeStudioPilotErrorCodeV3 = 'project_piece_capacity_reached'` and compares it
to the same literal — compile-time union membership dressed as a runtime expectation. The `perPiece: 5` /
`perProject: 480` thirds are real freezes, and the code _is_ asserted as actually raised elsewhere
(`media.integration.test.ts:618, 644`; `preparation-confirmation.integration.test.ts:355, 389`). Delete
the third.

**P3-7. The generated crash matrix has a duplicated arm.** `media.ts:1632` passes
`reportDurableStep = false` and reports `media:stage_durable` at `:1677`, _after_ `publishIntent` at
`:1673`. So the `stage_durable` and `intent_durable` arms of `media.integration.test.ts:955-999` /
`1001-1063` leave byte-identical state and both recover to `succeeded` — a four-name matrix over three
states. The import matrix (`:648-689`) is genuinely four-point. No shipped-code defect; a mis-attributed
coverage point.

**P3-8. Every rename refusal collapses to `invalid_payload`.** `entryPoint.ts:99-107` maps only
`authoring_revision_conflict` and `piece_not_found`; the reducer distinguishes eight reasons and
`mapHandleError` carefully preserves `handle_collision` / `alias_limit` / `no_change`. Two new tests
freeze the flattening (`entry-point.integration.test.ts:338, 385`). `CreativeStudioPilotErrorCodeV3` was
_added_ by this commit and is not in the contract-version matrix, so adding members in phase 5 is purely
additive — hence P3, not a frozen-contract break. Phase 5's stated requirement (reporting collision and
bound refusals) needs those members.

**P3-9. `resume`/`retryDownload` bind a whole-project revision that `cancel` was deliberately exempted
from.** Both enforce `expectedRevision` against the whole project twice (`jobs.ts:722`, `:798`), while
`StudioCancelPieceJobRequestV3` carries none and an explicit comment saying why
(`creativeStudioTypes.ts:2202`). Target eligibility is already proven exactly at `jobs.ts:724-746`, so
unrelated Piece progress can refuse a paid-output recovery (`jobs.integration.test.ts:1785-1805` locks
this in). _Export is excluded_ — there the whole-project revision is load-bearing ("export exactly the
image you were shown"). A design inconsistency for phase 5 to settle, not a rule violation: the plan's
"runtime activity cannot stale a direct action" refers to Director/authoring operations, not a resume
click.

**P3-10 (process). The phase-1 contract was amended inside the phase-3 implementation commit.**
`11c2b497b` adds a new persisted Job field (`providerSubmissionKind`, `creativeStudioTypes.ts:1855`,
added to `JOB_KEYS_V3` at `validation.ts:2841`), ~10 new cross-record invariants in
`validateStudioProjectV3`, new export retention bounds (`types:1710-1711`), a V2→V3 `byteSize` fix
(`validation.ts:3801`), **and** the +19-line plan edit that authorizes them.

Nothing is wrong on the merits — no version constant moved, the invariants ship with +372 lines of
validation tests, and the retention bound faithfully ports the pre-existing
`STUDIO_MAX_EXPORTS_PER_SHAPE = 5`. The issue is that the freeze provided no independent check, and any
later plan-versus-code comparison now agrees by construction. Concrete residue: the retention **number**
never entered the "Exact Pilot 1 shape and bounds" table the plan declares authoritative, while
`export.ts:922/938` physically evicts the displaced artifact directory.

**P3-11. A pending Piece's requested aspect ratio is unreachable by the renderer.** `consume()` deletes
the prepared reservation, and neither post-confirmation projection carries `settings`; `currentAsset` is
null until publication. The data **does** exist durably — `job.composition.inputs.source.settings` and
`job.requestPlan.snapshot.settings` — so this is a one-field additive projection omission, not the
"frame ratio must come from persisted data" class. The sibling provenance projection already reaches into
`producer.composition.inputs` (`projections.ts:308-309`), so exposing it costs nothing.

---

## Untested, but the implementation looks correct

A different conversation from the defects above. **Phase 4 is the lifecycle gate and legitimately owns
most of these.**

- **The real provider resolver is never composed.** All seven pilot test files inject a hand-built
  `StudioGenerationRouteCatalog`; none constructs `createStudioProviderResolver`. **Phase 4's job
  explicitly** — the plan's phase-4 scenario text requires the fake adapter through "the isolated CS4
  entry point's real provider resolver". The rate/route join is _not_ an EPIC-002-class hazard:
  `pricing.ts:49` builds the rate card from the same catalog object it resolved the route from, so the
  `choiceId → routeId` join is an identity mapping over one array and cannot miss.
- **Two concurrent schedulers over one rootDir.** Every "restart" disposes first
  (`runtime.integration.test.ts:182, 239, 378, 531, 717`). This is the load-bearing unknown behind P3-2 —
  but multi-writer is not a declared invariant anywhere in the phase docs, and a naive two-manager test
  would be order-dependent rather than deterministically red. Note it in the phase-4 brief; do not write
  a flaky test.
- **An aged `queued_local` authorization.** The 5-minute quote TTL is enforced at confirmation and
  nowhere after; `resumePendingJobsV3` schedules unconditionally and `jobs.ts` never reads `spendPolicy`,
  `quote.expiresAt`, or `authorization.confirmedAt` (zero grep hits). Defensible today — the
  authorization is durable and the rate is a compile-time constant — but nothing pins behaviour for an
  aged authorization, so a later variable-rate or consultative-policy change lands unguarded. **Worth a
  product ruling before phase 5 wires the UI.**
- **A cancelled job can end with no receipt after the provider produced paid output.** No
  `signal.aborted` re-check between a `succeeded` poll snapshot arriving and `publishCompletion`
  (`jobs.ts:570-571`). Requires a self-contradicting provider **and** no intervening durable write.
  Residual risk inherent to remote cancellation, not a defect in this commit.
- **A rejected `startV3` is memoized forever.** `entryPoint.ts:351-360` uses `??=` and nothing clears
  `startPromise`. One transient `inspectProjectsV3` failure at boot means `resumePendingJobsV3` never runs
  for the session. **A precondition for the phase-4 lifecycle gate being retryable** — clear the promise
  on rejection.

---

## Observations — no action required

- `recoverAllMediaV3` silently discards the `projectIds` argument `entryPoint.ts:355` passes; its own
  contract is `recoverAllMediaV3()` (`media.ts:155`) and the impl re-runs `inspectProjectsV3`
  (`:1809-1816`), while the exports and jobs arms honour it. One wasted whole-root scan per start.
- `dispatchCommittedJobV3` admits `submitting` (`jobs.ts:38-43, 848`) but `runJob` no-ops it (`:646`).
  Benign today; a latent trap for a phase-4/5 retry caller.
- `rate_not_found` and `variable_price_unsupported` are declared (`types:2380-2381`) with **zero
  producers** — both collapse to `route_unavailable` at `pricing.ts:51-52`. Fail-closed is preserved;
  dead vocabulary plus a slightly wrong message for phase 5.
- A rename's undo entry is permanently invalidated by any subsequent Piece creation or import
  (`pieceCatalogV3.ts:306-318, 345` vs `confirmation.ts:324`, `media.ts:1470`), and nothing prunes it.
  Deliberate and tested; input for phase 5's undo affordance.
- `undo_last` needs an `entryId` no projection returns, and the phase-3 test reads it off
  `store.loadProjectV3()`. Both projection types were frozen by phase 1 and phase 3's work items never
  asked for an undo projection, so this is a **phase-5 forward gap**: phase 5 must amend a phase-1 type to
  enable or label an Undo control.
- Seven hand-copied `/^[A-Za-z0-9_-]{1,256}$/` id regexes (`contracts.ts:26`, `entryPoint.ts:93`,
  `prepare.ts:63`, `projections.ts:27`, `media.ts:45`, `pilotStore.ts:41`, `export.ts:38`), two missing the
  `u` flag. They admit a UUID — harmless here, because no schema-6 request accepts a caller-minted
  identity at all and every other id is a lookup key that fails as `not_found`. Duplication hygiene only.
- Three of the fourteen new manifest entries are pure re-export barrels (`service/pilot/index.ts`,
  `service/pilot/runtime/index.ts`, `service/director/index.ts`). Because the gate is `perFile` they
  dilute nothing, and four pre-existing barrel entries already set the convention. The pilot block is
  inserted mid-list rather than alphabetically, which will make future manifest diffs noisier.
- The projection tests deep-equal whole DTOs in ~5-6 places, so an additive phase-5 field costs a
  deliberate test edit. Intentional and defensible for a Main↔renderer contract.
- Hand-authored durable receipt/asset/piece literals seed input state in three test files
  (`preparation-confirmation.integration.test.ts:893-923, 190-236`; `media.integration.test.ts:159-201`)
  for paths the public API cannot cheaply reach (95 pieces to hit a ceiling; a succeeded remote job to
  test retry ineligibility). Each is committed through the real validator and none is asserted back. Not
  the violation it resembles — the rule forbids such literals _as the integration oracle_.
- `realFixture.ts` never cross-checks the _achieved_ outcome against a requested
  `generatedOutcome: 'succeeded'`, so a publication regression yields `assetId: null` and a
  `managedPhotoPath` pointing at the unmanaged source. No consumer can pass green on that, so this is
  diagnosis quality only. One line after `:187` closes it — but the `assetId === null` branch is a
  designed, exercised feature (`generatedOutcome: 'failed'`, three call sites), so do not make the guard
  unconditional.

---

## Refuted — do not act on these

1. **"Export manifest `toEqual` could hide a provenance leak."** Every field in the scenario
   (`asset.sha256`, `provider`, `authoringFingerprint`) is in the sidecar _by design_ and checked by
   `validateStudioPieceExportConsistencyV3`; `managedAsset.fileName` cannot be written at all —
   `serializeStudioPieceExportManifestV3` gates on `hasExactKeys(EXPORT_MANIFEST_KEYS_V3)` and
   `pieceManifestV3.test.ts:291-293` proves an injected `absolutePath` throws. The proposed remedy would
   assert a violation of the sidecar spec.
2. **"The rate/route join has zero wire-level evidence."** Refuted on mechanism — see the resolver note
   above. Nothing is minted on one side and dictated on the other, so it is not the UUID-vs-short-id
   class.
3. **"No asset byte-serving surface: a Piece's photo can never reach a renderer."** Refuted as a phase-3
   defect on scope: phase 3's stated exit is "No renderer claims are made yet"; phase 5 item 1 owns the
   bridge cutover and item 6 owns rendering. Two evidence defects too: the cited `store/mediaStore.ts`
   does not exist (it is `creative-studio/mediaStore.ts`), and the pilot store _does_ expose
   `mimeType`/`byteSize` plus a verified path via `verifyManagedAssetV3`. **Real forward work worth
   tracking:** adding `openVerifiedStream` to the pilot media store is the phase-5 entry cost.
4. **"Export narrows schema-5's save dialog and reveal-in-folder."** Refuted as scope: neither contract
   doc mentions destination or reveal for export; phase-3 item 9 specifies exactly what landed, and the
   CS3 affordances live in the bridge layer the plan assigns to phase 5.
   `StudioRendererPieceExportArtifactV3` was added by this commit and is not version-frozen, so a
   path/reveal field is additive.
5. **"`undo_last` is unreachable through the public surface" as a P2.** `CreativeStudioPilotRuntimeV3`
   publicly exposes `store` alongside `entryPoint`, and phase 3's exit sentence includes "and durable
   storage", so a phase-4 scenario reading `undoHistory` is inside the stated surface. Survives only as
   the phase-5 observation above.
6. **"Sibling handles lose the Director suggestion's stem past 46 scalars" as a P2.** Mechanism
   confirmed and the contradicting doc line _was_ added by this commit (`plan:226-229`) — but the failure
   scenario is unreachable: **nothing anywhere in the creative-studio tree or the renderer does
   suffix-stripping or stem grouping.** The truncation is deliberate and covered by a pre-existing test
   titled "reserves room for suffixes". The doc sentence is the thing to fix, not the code.
7. **"No test runs two concurrent schedulers" as a P2 coverage hole.** Facts confirmed, framing refuted —
   reclassified as a phase-4 brief note.
8. **"A dispatch failure leaves no in-session recovery" as a defect.** The test it criticises mirrors the
   phase-3 contract's own wording, and in-session re-drive is nowhere in phase 3. One thing worth
   knowing: `onDispatchError` (`confirmation.ts:50, 409`) has **no caller anywhere** in `packages/` or
   `tests/` — the one seam that could surface or recover from this is dead code.
9. **`waiting_for_conditioning`** is a clean negative result, not a finding: zero hits under
   `service/pilot/`, `pilotStore.ts`, or the pilot tests. The ninth status lives only on
   `StudioJobStatusV2`, which the Pilot job type does not use. No dead implementation, no test asserting
   unreachable behaviour.

---

## Unadjudicated leads

The adversarial verifier hit its budget before resolving these five. They are leads, not findings.

1. The 30-minute poll deadline is per-invocation (`jobs.ts:519`), so a resumed job may be re-polled
   indefinitely across restarts while the persisted `remoteStartedAt` is never used for deadline
   arithmetic. Resource/UX, no spend.
2. Two runtimes over one project directory would surface a benign on-disk CAS loss as the user-facing
   `project_quarantined` (`pilotStore.ts:704-712` → `errors.ts:33`).
3. Schema-6 has **no writer** for `briefConversationId` or `forgeProjectId` — both required keys of the
   persisted envelope and of `PROJECT_KEYS_V3`, hardcoded `null` by `createEmptyStudioProjectV3`, with no
   mutation operation to set them. Relevant to phase 5's Director rail and to the recorded
   Director-attach id-mismatch class.
4. Two of the four barrel/manifest reports (the underlying fact was verified independently).
5. The three barrels' _measured_ coverage percentages. The only `coverage-summary.json` on disk is stale
   — it names files this commit deletes or renames — so no measurement is cited anywhere in this review.

---

## What this review did not cover

**Nothing was executed.** No vitest run, no coverage run, no build. Every claim is from reading code at
`11c2b497b` via `git show` / `git grep` plus the assertions the tests make. The contract was read from
the **branch** copies of `creative-studio-4-canvas-design.md` and `creative-studio-4-phase-1-plan.md`;
the worktree copies are stale by 74 lines and were deliberately not used.

Within the tests, roughly 1,180 lines of `jobs.integration.test.ts` (of 1,981) and ~900 of
`media.integration.test.ts` (of 1,433) were read as `it()` title lists plus sampled bodies, so additional
vacuous assertions could exist in the remainder. On the source side, `media.ts`'s sharp inspector, MIME
sniffer and grid-detector internals and the middle of `importPhotoV3` were skimmed rather than audited
line by line; `export.ts`'s quarantine and recovery paths were read only at their commit builders and
revision handling; `confirmation.ts` was audited at its decision and commit seams rather than end to end.
Whether the ~10 new cross-record validator invariants are exercised by anything beyond the added
`validation.test.ts` cases was not established.

---

## A note on this document's own visibility

This review lives on `claude/shared-conversation-hygiene`, which is based on the CS3 base branch — **not
on `codex/creative-studio-4-pilot`**. It is therefore invisible from the branch it reviews.

That is not incidental. This review's own first attempt at a phase-4 assessment was wasted because the
worktree copy of `creative-studio-4-canvas-design.md` (559 lines) still described phase 4 as a Playwright
E2E and "the acceptance gate for the contract", while the branch copy (485 lines) had already replaced
that with "a headless integration gate, not the user E2E" — a decision `11c2b497b` itself documents in
the phase-1 plan at `:700-703`. Reading the wrong copy cost a full review cycle.

Whoever merges the pilot branch should carry that revision forward to the base, and until they do, any
agent reasoning about CS4 phases from a CS3-based worktree is reading a document that has been overtaken.
