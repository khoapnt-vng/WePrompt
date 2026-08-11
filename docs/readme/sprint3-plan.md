# Sprint 3 Plan

- **Drafted:** 2026-08-10
- **Proposed window:** 2026-08-11 → 2026-08-22 (two weeks — confirm)
- **Baseline:** `sprint3` @ `05abda690` (Sprint 2 tip `dc7460883` + three ported commits)
- **Status:** draft for review

## Sprint goal

**Make the delivery chain real, then prove it with a packaged build.**

Sprint 2 closed with working code and an unusable release path: a provenance pin naming a
commit that existed nowhere, packaged acceptance that never ran, and zero automated
verification. Sprint 3's job is to turn "merged" into "shipped" for a reduced platform
matrix, and to leave behind a chain where every link is independently checkable.

Success looks like: a signed macOS ARM and Windows build, installed from scratch and
upgraded from a Sprint 2 database, whose backend binary can be traced to a reviewed commit
by someone who was not in the room.

### Non-goals

- **Creative Studio** — steered separately by the product owner; not in this plan, not in
  this sprint's capacity, and `CREATIVE_STUDIO_ENABLED` stays off.
- macOS Intel packaging — explicitly deferred as an approved reduced matrix.
- SSO, EPIC-004 Excel, and the data connectors — unchanged admission gates, no Sprint 3 work.
- BUG-017 SQLite access loss — still needs a reproduction before any design.

## Platform and ownership decisions already made

| Decision                   | Value                                                              |
| -------------------------- | ------------------------------------------------------------------ |
| Development and CI home    | **GitHub (model A)** — GitHub is primary; GitLab receives a mirror |
| WePrompt repository        | `github.com/khoapnt-vng/WePrompt`                                  |
| AionCore repository        | `github.com/khoapnt-vng/aioncore`                                  |
| Platform matrix            | **macOS ARM + Windows**; Intel deferred                            |
| AionCore build and signing | **khoapnt**                                                        |
| EPIC-003 delivery          | **khoapnt**, after this plan is shared                             |
| GitLab CI                  | None — the only instance runner is stale (last contact 11 months)  |

### Standing risk, accepted knowingly

Neither `khoapnt-vng` nor `dto-aiprojects-vng` is a GitHub **organization**; both are personal
accounts. Primary source of truth, CI, and signing therefore sit on individual accounts — the
same exposure Sprint 2 filed as P1 against `minhtq1234/Forge-Aion`, now widened. This is
accepted for Sprint 3, not resolved. **Owner action: file the VNG GitHub org request in week 1
so it is not still open at Sprint 4 planning.**

---

## Track 0 — Unblock (must land before anything else)

> **CLOSED 2026-08-10.** All three items are done and merged to `sprint3`. T0.1 published the
> corrected baseline; T0.2 fixed the release line at `v0.1.51`/`d4d8e877` and its corrected
> record is tracked at [docs/design/aioncore-sprint3-release-line.md](../design/aioncore-sprint3-release-line.md);
> T0.3 shipped the main-process interceptor plus the fifth call site it could not reach
> (`3492449f3`). Tracks 1, 2 and 4 are now admissible. Detail below is retained as the record of
> what was decided and why.
>
> **Also delivered in the same window, outside the original plan:** the first CI pipeline in this
> repository's history (`sprint3-pr-gate.yml`, macOS, blocking as of `af4a8af75`), which passed a
> full hosted run at `31405462957`. It immediately produced two findings — BUG-042 and BUG-043 —
> neither of which any local gate could have surfaced.

### T0.1 Publish the corrected baseline

- [ ] Push `dc7460883` to `khoapnt-vng/WePrompt:sprint2` (verified fast-forward; GitHub's
      `4c523888` is an ancestor).
- [ ] Push `sprint3` @ `05abda690` and make it the working branch.
- [ ] The `build/win-oauth-fix-*` branches are **internal demo builds**, deliberately cut from
      the older `4c523888` snapshot; they are not release candidates and need no rebase. Treat
      them as throwaway. Their useful commit (`658ed0335`) is already ported to `sprint3` as
      `515d0b963`, with two defects fixed — see T0.3 and the port notes.
- [ ] **Release builds come from `sprint3` only.** Because the demo branches are 126 commits
      behind, demo feedback is against pre-freeze code: triage it against `sprint2` before
      filing, or already-fixed issues will be re-reported as new.
- [ ] Configure the GitLab mirror direction and record the cutover point, so `TASKS.md`'s
      `!1`–`!103` evidence links stay readable alongside future GitHub PR numbers.

### T0.2 Release line — **DECIDED 2026-08-10**

**The Sprint 3 AionCore release line is `d4d8e87714690cdb230ab7a6987de3ceacbea275`**, the
target of tag `v0.1.51`. It resolves identically on `code.vng.vn/dto/aioncore` and
`github.com/khoapnt-vng/aioncore`, and it is the release whose cross-verified checksums the
desktop build already pins. `ACCEPTED_AIONCORE_SOURCE_COMMIT` is aligned with it as of
`515d0b963`; no further change is required.

Candidates not chosen, and why it matters that they were considered:

| Candidate  | What it is                | Disposition                                                                                         |
| ---------- | ------------------------- | --------------------------------------------------------------------------------------------------- |
| `fbe0ac6b` | `fix/mcp-oauth-discovery` | **Not the release line**, despite the decision record designating it. Same tree bar Cargo metadata. |
| `9b418ea3` | target of tag `v0.1.52`   | Newer. Forgone deliberately — see below.                                                            |

Two consequences that must be written into the backend decision record:

- [ ] **The record's designated branch is wrong.** It names `fix/mcp-oauth-discovery` as the
      release line and instructs that this branch be protected. The chosen commit is not on
      that branch's tip lineage — it is the `v0.1.51` tag on `security/pilot-hardening-d01-d06`.
      Restate the branch policy against the line actually being shipped.
- [ ] **The release line is a tag, not a branch head.** `security/pilot-hardening-d01-d06` has
      already advanced past it on GitHub. Pinning an immutable tag is the safer choice, but it
      means "merge accepted changes back into the release line" no longer describes reality:
      future work lands on a branch and is cut as a _new_ tag, which then becomes a new pin.
- [ ] Correct the record's Sprint 2 backend table: BUG-013 has **no recoverable AionCore
      commit**. The `260dbbc05…` value is fabricated and absent from all three hosts.

**Deliberately forgone by this choice:** `v0.1.52` is `v0.1.51` plus exactly two commits —
`b2c329d fix(mcp): send stored OAuth token on MCP connection test` and a version bump. Pinning
`v0.1.51` therefore gives up one MCP OAuth connection-test fix in exchange for staying on the
release whose checksums are already cross-verified. Revisit at the next tag, not mid-sprint.

### T0.3 Local-auth transport for header-less consumers — **design required, P0**

The pinned fork accepts only `Authorization: Bearer`, the `aionui-session` cookie, and — for
WebSocket upgrades only — `Sec-WebSocket-Protocol`. It has **no query-parameter auth path**.
WePrompt's `withLocalTokenQuery` therefore fails against it at four sites:

| Call site                   | Purpose                   | Viable fix                       |
| --------------------------- | ------------------------- | -------------------------------- |
| `SpeechStreamClient.ts:115` | STT WebSocket             | Pass token as subprotocol        |
| `httpBridge.ts:146`         | main `/ws` WebSocket      | Pass token as subprotocol        |
| `WeixinConfigForm.tsx:258`  | EventSource, WeChat login | Cookie, or backend accepts query |
| `platform.ts:61`            | media / `<img src>` URLs  | Cookie, or backend accepts query |

**DECIDED 2026-08-10: inject the credential in the main process.** Install a
`session.defaultSession.webRequest.onBeforeSendHeaders` handler that adds
`Authorization: Bearer <localToken>` to requests aimed at the backend origin, and **delete
`withLocalTokenQuery` and `LOCAL_TOKEN_QUERY` entirely**. One mechanism covers all four sites,
because Electron's `webRequest` sees `<img>`, `EventSource`, `fetch`, and WebSocket upgrades
alike, and it is indifferent to the renderer's origin.

Rejected, with reasons worth keeping:

| Option                                                  | Why not                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aionui-session` cookie                                 | The cookie **does** carry the local token (`middleware.rs:83` compares whatever `extract_token_from_headers` returns). But the renderer is **cross-site** to the backend — `Origin: null` when packaged via `loadFile`, a vite URL in dev — so the cookie would need `SameSite=None`. That re-opens the browser CSRF drive-by that D-01 exists to close (`middleware.rs:80`). Actively regressive. |
| Add a query-param path to the fork                      | Needs a Rust change on khoapnt's critical path, puts a credential in URLs (logs, history, referrers), and re-adds a surface the fork's authors deliberately omitted.                                                                                                                                                                                                                               |
| Per-site fixes (WS subprotocol + something for `<img>`) | Two mechanisms, partial coverage, more code, same end state.                                                                                                                                                                                                                                                                                                                                       |

Implementation, in order:

- [ ] Scope the filter to **exactly** `http://127.0.0.1:<backendPort>/*` and
      `ws://127.0.0.1:<backendPort>/*`. A broad filter would attach the local token to
      arbitrary outbound requests — the one way this change can make things worse.
- [ ] **Gate it to the app-shell `webContents`.** `session.defaultSession` is shared with
      partition-less `<webview>` guests, and `URLViewer` renders arbitrary remote URLs; an
      ungated interceptor would let guest content reach the backend authenticated. The
      backend's `Origin` allow-list (`rendererAllowedOrigins()`) is a second layer, not a
      substitute. Moving those two viewers onto dedicated partitions resolves this **and** the
      CSP shared-session caveat at `index.ts:724` — prefer that if the cost is acceptable.
- [ ] Verify `onBeforeSendHeaders` fires for the `webSocket` resource type on the Electron
      version in use before relying on it for the two WS sites.
- [ ] Remove `withLocalTokenQuery`, `LOCAL_TOKEN_QUERY`, and their four call sites. Net
      security improvement: the token stops appearing in URLs.
- [ ] Cover all four sites with tests that fail against the pre-fix transport.

**This is a release blocker, not a follow-up.** A packaged build from today's branch ships
broken media, WeChat login, and speech streaming — in exactly the installer this sprint exists
to produce.

**Implemented 2026-08-10** (`44f00a112`, merged). The interceptor lives in
`packages/desktop/src/process/startup/localBackendAuth.ts`, is filtered to the runtime backend
port, gates on `details.webContentsId === appShell.id`, re-checks the origin as defence in
depth, and fails closed to _unauthenticated_ on a malformed URL. `withLocalTokenQuery` and
`LOCAL_TOKEN_QUERY` are gone along with all four renderer call sites.

#### T0.3 follow-up — a **fifth** call site the interceptor cannot reach

- [ ] `PresentationRuntimeEventClient.ts:221` builds `ws://127.0.0.1:<port>/ws?local_token=…`
      inline, which is why a `withLocalTokenQuery` grep missed it. It runs in the **main
      process** over the Node `ws` library (`createSocket(url, options)`, `socket.on('open')`),
      so it never enters Chromium's session layer — `onBeforeSendHeaders` cannot see it, and
      the `webContents` gate would exclude it even if it could.
- [ ] **Not urgent, but latent:** it is reached only through
      `createPresentationRunLifecycleCoordinator`, behind `PRESENTATION_RUN_V2_ENABLED = false`
      (`index.ts:346`). Dormant today; it will 401 the moment that flag flips.
- [ ] Fix is small: `ws` accepts `headers` in its constructor options and `createSocket`
      already forwards them, so pass `Authorization: Bearer <token>` and drop the query
      parameter. Must land **before** EPIC-001 V2 is enabled.

---

## Track 1 — Provenance and artifact chain

The half of delivery hardening that needs no new infrastructure. This is the direct answer to
BUG-040.

### T1.1 Define the artifact contract

- [ ] A release artifact must carry: the native binary, the exact source commit,
      `migration-lineage.json`, required managed resources, SHA-256 checksums, and signing or
      provenance evidence.
- [ ] Record the contract in `docs/design/` before changing WePrompt's backend resolver.
- [ ] Confirm the build archives `migration-lineage.json` **alongside** the binary. Upstream's
      release workflow archives the binary only, which is why default packaging fails closed.

### T1.2 Bind the pin to a verifiable source

- [ ] Replace any pin that cannot be resolved on the publishing host.
- [ ] **Required control:** after every build, assert the built SHA resolves on the
      source-of-truth host before the artifact is accepted.

  ```bash
  git ls-remote https://github.com/khoapnt-vng/aioncore.git | grep -q "$BUILT_SHA"
  ```

  This single check is what BUG-040 would have failed. Make it a required release step.

- [ ] No test fixture may act as the authority for a provenance value. A reviewer obtains the
      commit, digest, and signing evidence independently from the published build.

### T1.3 Re-verify what `!79` claimed but never proved

The fabricated pin removed the presumption of accuracy from that MR's other claims. Three were
independently confirmed defective and remain open:

- [ ] No test injects a real lineage failure and proves the rejection → preservation → quit
      chain. The quit path is real; the behavioural proof is not. Write it.
- [ ] The packaged recovery test installs a prebuilt failure object, skips AionCore startup
      entirely, and is excluded from `bun run test`. Make it real: seed a database, exercise
      lineage preflight, prove preservation.
- [ ] Native CI acceptance as written cannot pass, because it consumes an archive that lacks
      `migration-lineage.json`. Fix or retire the claim.

### T1.4 Close BUG-040

- [ ] Close only with a real signed artifact, independently verified provenance, and genuine
      packaged recovery evidence. Until then BUG-013 stays **partially hollow**: runtime
      rejection real, packaged end-to-end acceptance not.

---

## Track 2 — Backend ports (khoapnt + core)

Port by **contract and tests**, never by raw commit transfer. Both original commits were
developed against a different AionCore history.

### T2.1 BUG-013 — migration-lineage fail-closed

- [ ] Port the behaviour onto the chosen release line. There is no source commit to cherry-pick.
- [ ] The chosen baseline already carries migrations `001…027` — **exactly** the lineage
      WePrompt's accepted `migration-lineage.json` matches, and which Sprint 2 verified three
      independent ways. The lineage contract needs no change; inherit the verified provenance.
- [ ] Failing regression test first, focused green evidence, independent exact-head review.

### T2.2 BUG-015 — provider token usage

- [ ] Port the contract from `2a9a02e27` (real, on the GitHub contributor fork via PR #808).
- [ ] Acceptance: a bundled Kimi turn records non-zero local usage, survives reload, and does
      not double-count a replayed finish event.
- [ ] Until that runs against the exact bundled binary, do not claim the local-token-total half
      is shipped.

---

## Track 3 — CI on GitHub Actions

Model A makes this cheap: hosted `macos-14`/`macos-15` (ARM) and `windows-latest` runners exist
today, which is why the GitLab runner problem stopped mattering.

### T3.1 Pull-request pipeline — Linux only

- [ ] `tsc --noEmit`, oxlint, oxfmt, `bun run i18n:types`, `node scripts/check-i18n.js`, and the
      full Vitest suite, on `ubuntu-latest`, on every PR.
- [ ] Baseline to hold: **621 files / 8,120 tests, 19 skipped**, currently green on `sprint3`.

### T3.2 Quarantine the two known flakes on day one

- [ ] `jobManager.test.ts` — the capped-backoff and thirty-minute-deadline tests (BUG-027).
- [ ] `TeamSiderSection.dom.test.tsx` — the teardown that exits 1 after a green run (BUG-030).
- [ ] Each quarantined with a retry and a tracking link, so **a red pipeline always means
      something new**. Without this, the first fortnight of unattributable reds teaches everyone
      to ignore the gate.
- [ ] CI then becomes the reproduction harness both bugs needed and never got locally. Triage
      them from real samples rather than hunting reproductions by hand.

> **T3.1/T3.2 DELIVERED 2026-08-10.** `sprint3-pr-gate.yml` runs the full gate on `macos-15` for
> pull requests to `sprint3` and pushes to it. Actions are pinned to verified commit SHAs.
> BUG-027's two tests carry CI-only retries (`process.env.CI ? 2 : 0`, so local runs still surface
> the flake honestly) and BUG-030 is quarantined by exact log signature rather than a blanket
> allow-failure. The gate is **blocking** — `continue-on-error` was removed after a fully green
> hosted run.
>
> **Two traps recorded here so they are not repeated.** (1) `vitest run --exclude=<file>`
> **replaces** the resolved exclude list rather than adding to it — using it to carve out one file
> discovered 13,874 test files instead of 625. (2) `.github/workflows/pr-checks.yml` is **not** a
> generic quality workflow: it carries the mac/Windows build blocks, signing config, and packaged
> artifact-name checks that BUG-013/BUG-014 depend on, and `releasePackagingConfig.test.ts` pins
> its contents. New gates get new files.
>
> **Still outstanding:** the gate is blocking at the workflow level but **not enforced**, because
> `sprint3` has no branch protection. Only a repository admin can add one; the current maintainer
> account has `admin: false`. The required check must reference the **job** name exactly —
> `Quality and tests (macOS)` — not the workflow name, and required checks read the job
> conclusion, so a rule added while `continue-on-error` is present would block every PR.

### T3.3 Matrix jobs — concurrency, not cost

Both repositories are **public**, so standard hosted runners — including macOS ARM and
Windows — are free with no minute billing. The 10×/2× private-repo multipliers do not apply
and no paid plan or self-hosted runner is required.

- [ ] Budget against **concurrency** instead: the free tier allows a limited number of
      simultaneous jobs, with macOS the tightest. A wide matrix on every PR will queue.
- [ ] Run the macOS/Windows matrix on release branches and tags; keep per-PR to Linux. This is
      now a latency choice, not a cost one, so relax it if queueing is not a problem in practice.
- [ ] Do not use larger runners — those are billed even on public repositories.

---

## Track 4 — Packaged acceptance (macOS ARM + Windows)

The proof that the sprint goal was met. Runs against the installed application and the bundled
binary, not source tests.

- [ ] Clean installation and first launch.
- [ ] Upgrade from the last accepted Sprint 2 database.
- [ ] Incompatible or malformed lineage fails closed **without mutating user data**.
- [ ] Authenticated local API and WebSocket startup — covers T0.3's four call sites.
- [ ] Provider streaming and token-usage telemetry.
- [ ] MCP OAuth discovery and Dynamic Client Registration.
- [ ] Retry and recovery after backend startup failure.
- [ ] Binary, checksum, signature, and lineage verification.
- [ ] Record artifact identities, checksums, source commit, and lineage fingerprint in the
      release note. Note macOS Intel as deliberately unaccepted.

---

## Track 5 — EPIC-003 reasoning controls (khoapnt)

Capability-driven provider/model reasoning controls. Delivered by khoapnt; this plan is the
handoff artifact.

### Entry gate

- [ ] Track 0 closed and Track 2 merged. No reasoning slice is admitted before the backend line
      and the pin are settled.

### T5.1 Re-charter — **COMPLETED 2026-08-11. Verdict: ADMISSIBLE.**

> **EPIC-003 is NOT blocked by the `001…027` baseline.** No plan step reads or writes anything
> migrations `028–037` would have created, and `027_provider_model_settings.sql` is the correct
> per-exact-model carrier the AionCore plan builds on. The migration cost is **mechanical**:
> `038`/`039` become `028`/`029`.
>
> **But removing DR-3 exposed what it was masking.** The migration gap was never the real
> blocker. Six conditions now gate the epic, none of them about migrations, and the first is
> serious: **DR-2's discovery seam does not exist on the shipped backend.**

**Struck:** DR-3 part 2 (the 27 → 37 pre-epic bump) is **dead — strike it, do not reschedule.**
Its target was upstream `v0.1.62`, which is not our line. DR-3 part 1 survives intact. The
baseline work it existed to gate is **already landed**: `ACCEPTED_AIONCORE_SOURCE_COMMIT` =
`d4d8e877` (`prepare-aioncore.js:42`), `aioncoreVersion` = `v0.1.51`, lineage
`{minimum 19, latest 27, entries 27}`. Nothing is left to bump.

#### Blocking gates — replace DR-3 with these

- [ ] **EG-1 (blocks all backend and positive-path slices) — re-decide the discovery seam.**
      **Independently verified by the integrator:** `capabilities.reasoning`, `contract_version`,
      `capability_revision`, and `floor_version` return **zero hits** across the release-line
      tree. The `database.migration_lineage` boundary DR-2 names as its working precedent
      **also does not exist** in AionCore. WePrompt's classifier for it
      (`backendStartupFailure.ts`) is dead against the shipped binary and exercised only by the
      debug injection at `index.ts:620`.
      **DR-2's stated premise is FALSE and must be corrected in the same edit:** it claims
      WePrompt makes no runtime call to AionCore. It does — `/health` exists
      (`router/routes.rs:239`) and `packages/web-host/src/backend-launcher.ts` already polls it
      and blocks readiness on it. Recommended seam is therefore **(a) extend `GET /health`** —
      the only option where both sides of the wire already exist. Alternatives: (b) extend the
      `AIONCORE_LISTENING` stdout JSON (launcher-private), (c) build a success-path emitter
      (highest cost — the new-surface risk DR-2 claimed to avoid).
      **Passes when:** the decision record names one seam and its literal payload, and a
      WePrompt parser test pins that exact shape.
- [ ] **EG-2 (blocking) — re-derive "one source for both floors", or drop the runtime floor from
      contract v1.** Exactly one floor exists today and it is packaging-time only
      (`minimumSupportedVersion: 19`). No AionCore build has ever emitted a runtime
      `floorVersion`, and AionCore does not even produce `migration-lineage.json` — it is
      injected by the packaging job. DR-2's guard clause has no second consumer to unify with.
      **Two independently maintained floors drift, and a drifted floor fails OPEN** — the one
      mode this design exists to exclude.
- [ ] **EG-3 (blocks the AionRS slice) — establish ownership or de-scope.**
      **Independently verified:** all six `aion-*` crates are pinned to
      `git = "https://github.com/iOfficeAI/aionrs.git", tag = "v0.2.6"` (`Cargo.toml:56-61`) —
      **a repository the team cannot merge into.** No VNG- or khoapnt-owned aionrs remote exists
      anywhere in the repo or docs. DR-1's procedure is unexecutable against it. Compounding:
      the AionRS plan's base is tag `v0.2.10` while we ship `v0.2.6` — a four-tag gap no banner
      mentions. **Passes when:** the pin names a host we own, or the AionRS slice is explicitly
      de-scoped and its dependants marked blocked.
- [ ] **EG-4 (blocks positive-path claims) — re-base the capability matrix.**
      `provider-reasoning-capability-matrix.md` records evidence bases AionRS `4cf42f2d` and
      AionCore `81ef2589`; **neither is shipped**. It states no credentialed runtime probe was
      run, so no row has runtime confirmation on any tree — and it is the verbatim fixture source
      for all three plans, yet **received no staleness banner when they did**. Mitigating: the
      per-model rows are grounded in provider documentation and are largely
      baseline-independent; it is the stated bases and envelope shapes that need re-anchoring.
- [ ] **EG-5 (blocks every backend slice; owned OUTSIDE this epic) — ship
      `migration-lineage.json` inside the artifact.** No AionCore artifact on this line contains
      it: `release.yml` archives the binary alone, while WePrompt requires the file **in-archive**
      at four call sites in `prepare-aioncore.js` and errors without it. **Packaging of any new
      backend is already broken before `028`/`029` exist.** The generator sits on an unmerged
      Forge-Aion branch that neither repo tracks.
- [ ] **EG-6 (cost gate, not correctness) — budget a release cut.** Migrations are compiled into
      the binary, so `028`/`029` require a new tagged AionCore release before WePrompt can
      consume them.

#### Plan deltas — apply before execution

- [ ] **PD-1 — Renumber.** `028` and `029` are genuinely free; the line ends at `027` with no
      gaps. Because the line is VNG-owned we control merge order, so author them as concrete
      numbers rather than candidates.
- [ ] **PD-3 — Re-pin all three plans and one adjacent doc.** Each plan pins a base SHA and
      orders "stop and replan" on mismatch — `81ef2589` (AionCore), `4cf42f2d` (AionRS). **These
      are guaranteed to fire against `d4d8e877` and halt execution at step one.**
- [ ] **PD-6 — Lineage regeneration is one atomic release step with zero tolerance.**
      `prepare-aioncore.js:148-161` does `isDeepStrictEqual` against the accepted lineage and
      throws an integrity error no caller may fall back from. Sequence it deliberately or the
      release bricks.
- [ ] **PD-7 — Add one independent recomputation test BEFORE regenerating.** Every existing
      WePrompt lineage test is **fixture-echo** — it writes the module's own input as the
      fixture. This is the BUG-040 pattern in the exact machinery about to change.
- [ ] **PD-10 — Do not hang reasoning selections off `model_settings`.** Task 7 stores bounded
      selection sets on assistant, conversation, and cron rows; `model_settings` is a column on
      `providers`. Migration `029` is required.
- [ ] **PD-11 — Reconcile the branch/tag mismatch before authoring migrations.** `d4d8e877` is
      **not** an ancestor of `fix/mcp-oauth-discovery` (the branch the decision record names as
      the backend line); it is contained in `security/pilot-hardening-d01-d06`. Both trees end at
      `027`. Decide which branch the new migrations land on.
- [ ] **PD-12 — Corrected execution order.** The plans' AionRS → AionCore → WePrompt order is
      backend-first and both ends are blocked. Use instead: **WePrompt fail-closed slice (no
      backend dependency, startable today) → EG-1 seam decision → EG-3 ownership → AionRS if
      owned → AionCore emitter + migrations → EG-5 artifact → positive-path WePrompt.**

#### Open questions for the owner

- [ ] **EG-1:** which seam — extend `/health` (recommended), extend `AIONCORE_LISTENING`, or
      build an emitter?
- [ ] **EG-2:** does contract v1 carry a runtime floor at all? If "wire it later", drop it from
      v1 rather than shipping a drift-prone second source.
- [ ] **EG-3:** can the team obtain an owned AionRS fork? If not, the AionRS slice de-scopes.
- [ ] **EG-5:** who lands the lineage generator into the AionCore release pipeline, and on which
      branch? Hard prerequisite for every backend slice, owned outside this epic.
- [ ] **PD-11:** `028`/`029` on `security/pilot-hardening-d01-d06` or `fix/mcp-oauth-discovery`?
- [ ] **PD-10 downgrade policy:** is silent loss of a user's reasoning profile after a backend
      downgrade acceptable? If not, it needs its own column and the migration count grows.

### T5.2 Carry forward what still holds

- [ ] **DR-2 stands:** contract discovery rides the startup boundary as a success-path
      `capabilities.reasoning` stage; absent ⇒ `unsupported`; one source for both floors.
- [ ] **DR-1 changes:** pins are slice outputs recorded via `ACCEPTED_AIONCORE_SOURCE_COMMIT`,
      now against the GitHub release line rather than upstream.
- [ ] Existing evidence is tracked: the capability matrix and model-selector contract in
      `docs/design/` and `docs/prds/` (`!89`), and the backend decision record.
- [x] **PUBLISHED 2026-08-11.** The three implementation plans are now tracked and shareable:
      [AionCore](../design/epic003-aioncore-reasoning-controls-plan.md),
      [AionRS](../design/epic003-aionrs-reasoning-controls-plan.md), and
      [WePrompt](../design/epic003-weprompt-reasoning-controls-plan.md). Bodies are **verbatim**;
      each carries a banner stating the DR-3 baseline is dead and that T5.1 must be completed
      before any step is executed.
- [ ] They were found during worktree cleanup as the **only** copy, inside an untracked worktree
      that `git status` reported as clean — gitignored files are invisible to it. One
      `git worktree remove` would have destroyed 110 KB of task-level planning. **Do not leave
      handoff material in `docs/superpowers/`**; that directory is for local working state only.

### T5.3 Scope rule

- [ ] Capability-based and provider-agnostic. Do not hard-code Kimi, GreenNode, or Sol-style
      effort labels into the shared contract.

---

## Operating rules

- Branch from the exact accepted head; record base and head commits in every acceptance report.
- One bounded change per PR. A shared-contract PR may precede its consumers; unrelated fixes
  never share one.
- Failing test first for changed behaviour; focused green evidence; full suite before merge.
- Changed user-facing text uses i18n keys in all 12 configured locales, then `bun run i18n:types`
  and `node scripts/check-i18n.js`.
- **Every agent-introduced SHA, run ID, digest, or checksum is verified out-of-band at review
  time.** A sandboxed agent asked for a real-world anchor will produce a plausible fabrication,
  and self-referential tests will green it. This rule exists because that happened.
- Do not test migrations or recovery against real user data. Use synthetic or disposable copies.

## Definition of done — backend-dependent items

```text
WePrompt PR
  -> AionCore PR
  -> accepted release-line commit
  -> passing CI
  -> signed native artifact
  -> independently verified checksum and provenance
  -> exact WePrompt backend pin
  -> packaged end-to-end acceptance
```

A merged PR, a pushed branch, or a green source-only run satisfies only part of this chain.

## Risks

| Risk                                                  | Likelihood | Control                                                    |
| ----------------------------------------------------- | ---------- | ---------------------------------------------------------- |
| T0.3 auth design slips and blocks packaging           | High       | Decide in week 1; it gates Track 4 entirely                |
| Personal-account ownership of source, CI, and signing | Certain    | Accepted for Sprint 3; org request filed week 1            |
| Matrix jobs queue behind free-tier concurrency limits | Low        | Public repos bill no minutes; keep per-PR to Linux         |
| A newer AionCore tag invites a mid-sprint re-pin      | Low        | Line fixed at `v0.1.51`/`d4d8e877`; re-pin at tags only    |
| Quarantined flakes quietly become permanent           | Medium     | Each carries a tracking link; review at sprint end         |
| EPIC-003 starts against the dead DR-3 gate            | Medium     | T5.1 is an explicit entry condition                        |
| Owner-gated items stall the sprint, as in Sprint 2    | Medium     | Track 3/4 do not block Tracks 1–2; org request is parallel |

## Exit criteria

1. A signed macOS ARM and Windows build exists, from a commit resolvable on the publishing host.
2. Clean install and Sprint 2 upgrade both pass on both platforms.
3. Lineage rejection preserves user data, proven by a test that injects a real failure.
4. All four local-auth call sites authenticate against the bundled binary.
5. BUG-040 is closed with independently verified provenance, or explicitly still open.
6. CI runs the full gate on every PR, and a red pipeline means something new.
7. EPIC-003 is handed off with a re-chartered plan in a tracked location.

Anything not met is carried with a named owner and an admission gate — not folded into a
Done count.
