# BUG-043 readiness guard platform audit

**Windows verdict — analytical, medium confidence:** Windows is plausibly affected by the same
fail-open class, but the current evidence cannot establish that it is affected; approval must
remain untrusted until the exact guard is exercised on a shipped Windows filesystem/runtime or
the guard fails closed when durable file-identity evidence is unavailable.

## Observation

> **Addendum added during integration, 2026-08-10 — evidence unavailable to the original audit.**
> This document was written believing the failure was observed only on a **Linux** CI host, and
> its mechanism section reasons from Linux inode reuse accordingly. That framing is now too
> narrow: the same test **also failed on a macOS 15.7.7 GitHub runner**
> (run `31402821168`, head `6c49121c5`, job `Quality and tests (macOS)`), while passing locally
> on Darwin 24.6.0 — including under `CI=true GITHUB_ACTIONS=true`, which rules out the
> environment-variable cause that explains the other 25 BUG-042 failures.
>
> The discriminator is therefore **not the operating system and not the CI environment
> variables**, but something about the **CI runners' filesystems** shared by both hosted images
> and absent on the developer Mac. That makes the Windows verdict below _more_ concerning, not
> less: a mechanism that degrades on two different hosted filesystems is unlikely to be a
> property of one kernel. Treat the Linux-specific inode-reuse reasoning as one candidate among
> several rather than the leading explanation, and re-run the probe on a hosted runner before
> concluding.

- **Verified — repository record:** Linux is not a release target. BUG-043 remains relevant
  because Windows is shipped and has no recorded execution of this suite. The Linux CI result
  returned `ok: true` for the combined same-byte-replacement/hardlink-drift test while sibling
  mutation checks passed (`TASKS.md:16-30`).
- **Verified — source parity:** Run `31400538426` used head
  `c9dbc565395cfb7a14faeb667b73d6be2791a7e5` (`TASKS.md:24`). The service and test blobs at that
  head are byte-identical to this audit base, `6c49121c59213ef3fe7feed3ebd6cb9803bbbcf9`
  (Git object IDs `5e8338c0ae046362dfea5c744d35987b073ed54f` and
  `aa0cf3278dcda4df0fa97d69b401d38987fcd53a`, respectively).
- **Verified — local execution:** On Darwin with Node `v24.15.0`, Bun `1.3.14`, and Darwin kernel
  `24.6.0`, the permitted focused command passed 1 file and 21 tests. A separate Node stat probe
  observed `(dev, ino, nlink)` change from `(16777230, 78050173, 1)` to
  `(16777230, 78050174, 1)` after unlink/recreate, then to
  `(16777230, 78050174, 2)` after adding a hardlink. This explains the local pass; it does not
  prove other Darwin filesystems or hosts.
- **Verified — unavailable evidence:** This sandbox could not retrieve the GitHub log or official
  web documentation (DNS/network unavailable), could not connect to the local Docker Linux socket
  (permission denied), exposed no in-app browser, and cannot run Windows. The supplied assertion
  excerpt omits the failing expectation's source line.
- **Analytical:** Because the combined test contains two sequential expectations, the title and
  result shape alone do not prove whether Linux approved the unlink/recreate subcase or the
  hardlink subcase. The first expectation is the stronger source-based explanation below, but the
  exact CI subcase remains unconfirmed.

## Mechanism

### What is created and retained

- **Verified:** `writeInspectionCopy` opens `candidate.pptx` with `O_CREAT | O_EXCL | O_WRONLY`
  and adds `O_NOFOLLOW` only when Node exposes that constant. It streams the candidate bytes into
  that open handle while computing SHA-256, applies mode `0600`, then gathers both handle metadata
  with `FileHandle.stat({ bigint: true })` and path metadata with `lstat`
  (`packages/desktop/src/process/services/office-artifact/service/PresentationReadinessService.ts:402-424`).
- **Verified:** Creation is accepted only if both views are regular files, both report exactly one
  hardlink, the handle's size equals the copied byte count, the path is not a symbolic link, and
  path `(dev, ino)` equals handle `(dev, ino)`. The retained identity is SHA-256, byte length,
  `dev`, and `ino`; the handle is then closed
  (`packages/desktop/src/process/services/office-artifact/service/PresentationReadinessService.ts:427-448`).
- **Verified:** Path metadata comes from ordinary-number `lstat`, while handle metadata comes from
  bigint stat; `sameOpenFile` converts the already-produced number to bigint. This mixed-precision
  comparison can fail closed if a platform reports an identifier outside JavaScript's exact integer
  range, but the cross-phase retained identity itself comes from bigint handle-stat
  (`PresentationReadinessService.ts:420-448`).
- **Verified:** The initial candidate and every retained-candidate checkpoint compare only byte
  length and SHA-256. Those checks detect byte mutation but intentionally cannot distinguish two
  files containing identical bytes
  (`packages/desktop/src/process/services/office-artifact/service/PresentationReadinessService.ts:374-400,544-552`).

### What each later path check compares

- **Verified:** Each `assertInspectionCopy` first calls `lstat(path)` and requires a regular,
  non-symlink file with numeric, safe size and `nlink === 1`. It then opens the path read-only
  (again adding `O_NOFOLLOW` only if available) and requires the open handle to be a regular file,
  to have `nlink === 1`, and to match the preceding path view on `(dev, ino)`
  (`PresentationReadinessService.ts:451-490`).
- **Verified:** It hashes the entire open file with SHA-256 and records its size. A second
  handle-stat after the read must equal the first handle-stat on `dev`, `ino`, size, `mtimeNs`, and
  `ctimeNs`; otherwise it emits `HASH_MISMATCH` (`PresentationReadinessService.ts:492-526`).
- **Verified:** Finally, the observed SHA-256, byte length, `dev`, and `ino` must equal the identity
  captured at creation (`PresentationReadinessService.ts:554-571`). This check runs before external
  validation, after validation, after OOXML inspection, after every slide render, and once more
  before approval (`PresentationReadinessService.ts:619-647,650-660,672-725`). Any
  `ReadinessFailure` becomes `{ ok: false, blockers: [...] }`; only reaching the end returns
  `ok: true` (`PresentationReadinessService.ts:728-752`).

### Exact decision inputs

| Input/API                                                                        | How the guard uses it                                                                                                                       | Audit status                                                                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `open` / `FileHandle.stat({ bigint: true })` (handle-stat / OS `fstat` analogue) | Captures and rechecks the opened object's `dev`, `ino`, `nlink`, size, `mtimeNs`, and `ctimeNs`.                                            | **Verified** — `PresentationReadinessService.ts:408-420,470-515`.                                                            |
| `lstat(path)`                                                                    | Rejects missing, non-regular, symbolic-link, multi-link, or unsafe-size path entries and compares path `(dev, ino)` with the opened handle. | **Verified** — `PresentationReadinessService.ts:421-448,459-487`.                                                            |
| `dev` + `ino`                                                                    | The only cross-phase non-content identity. They must equal the creation snapshot.                                                           | **Verified** — `PresentationReadinessService.ts:438,524-525,563-568`.                                                        |
| `nlink`                                                                          | Must equal exactly 1 at creation and at each later lstat/handle-stat.                                                                       | **Verified** — `PresentationReadinessService.ts:427-435,465-487`.                                                            |
| size / byte length                                                               | Must equal the expected candidate length and stay stable across a read.                                                                     | **Verified** — `PresentationReadinessService.ts:380,398-399,430,489-495,511,565`.                                            |
| SHA-256                                                                          | Must match the expected candidate at creation and every checkpoint. Same bytes intentionally produce the same digest.                       | **Verified** — `PresentationReadinessService.ts:382-399,492-523,549-550,563-565`.                                            |
| `mtimeNs` + `ctimeNs`                                                            | Compared only between the before/after handle-stats around one read; they are not retained or compared with the creation snapshot.          | **Verified** — `PresentationReadinessService.ts:507-515,521-526`.                                                            |
| birth time                                                                       | Not read or compared.                                                                                                                       | **Verified** — no birth-time field appears in the identity or comparison at `PresentationReadinessService.ts:72-75,507-526`. |
| `unlink`, `writeFile`, `link`                                                    | Test-only operations: replace a path with identical bytes, then in a separate service run add an alias hardlink.                            | **Verified** — `tests/unit/process/services/officeArtifact/readiness/PresentationReadinessService.test.ts:177-196`.          |

### Best-supported Linux explanation

- **Verified:** The first test subcase unlinks the inspection path and recreates the same pathname
  with identical bytes during structural validation. The second subcase creates a hardlink alias.
  They execute in that order, and a failure of the first expectation prevents the second subcase
  from running (`PresentationReadinessService.test.ts:177-196`).
- **Analytical — high confidence, unconfirmed on Linux:** The most likely fail-open path is immediate
  reuse of the just-freed inode in the first subcase. After `writeInspectionCopy` closes its handle,
  unlink removes the original object. If recreate receives the same `(dev, ino)`, the replacement
  has identical SHA-256 and size, `nlink === 1`, and a stable before/after timestamp pair. Every
  comparison therefore succeeds. The new file's `mtimeNs`/`ctimeNs` can differ from the original
  without detection because cross-phase timestamps are not retained.
- **Analytical:** The alternative is a host/runtime/filesystem reporting `nlink === 1` after the
  hardlink was added. The source would then also approve because bytes, size, `dev`, and `ino` are
  unchanged. This is less consistent with normal local Linux hardlink accounting, but the missing
  CI assertion line means it cannot be excluded.
- **Verified limitation:** No Linux reproduction was possible in this audit. Therefore inode reuse
  is a source-supported hypothesis, not a confirmed root cause. Closing the mechanism question
  requires rerunning the two subcases separately on the failing Linux runner while recording
  lstat/handle-stat values before and after each mutation.

## Platform matrix

**Verified — API shape:** The locally installed Node 24 declaration uses one platform-neutral
`StatsBase<T>` containing `dev`, `ino`, `nlink`, and size; `BigIntStats` adds `mtimeNs` and `ctimeNs`
(`node_modules/.bun/@types+node@24.12.0/node_modules/@types/node/fs.d.ts:46-72,4512-4517`). The
canonical reference is [Node.js `fs.Stats`](https://nodejs.org/docs/latest-v22.x/api/fs.html#class-fsstats),
but the sandbox could not retrieve it during this audit. **Analytical:** The checked API shape
supports only a property-presence claim for Darwin, Linux, and Windows; it is not evidence that a
value is durable, nonzero, unique across replacement, or non-reusable on every filesystem.

| Evidence                     | Darwin                                                                                                                                                                | Linux                                                                                                                                                                                                                                                                               | Windows                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dev` + `ino` availability   | **Verified locally:** both were populated by Node. **Analytical:** Node exposes the fields but does not promise that a closed, deleted file's tuple cannot be reused. | **Verified API shape; analytical semantics:** Node exposes both fields. The CI outcome proves this guard can still approve drift on at least one Linux environment, but this audit did not capture its values. Inode reuse after deletion is compatible with the observed approval. | **Verified API shape; unverified runtime:** Node's platform-neutral `Stats` type exposes both fields; no checked Node contract establishes that their Windows values are nonzero, unique across replacement, or non-reusable after the original handle closes. Treat the pair as unreliable for this security decision until measured on the shipped filesystem/runtime. |
| `nlink` availability/meaning | **Verified locally:** 1 became 2 after `link`.                                                                                                                        | **Verified API shape; unverified failing host values:** the field exists, but its values were not captured from CI.                                                                                                                                                                 | **Verified API shape; unverified runtime:** the field is present in Node's type, but this audit has no Windows evidence that the shipped filesystem supports hardlinks and reports the count in the way this guard assumes. If `link` is unsupported or throws, validation blocks closed; the risk is a successful link whose count remains indistinguishable from 1.    |
| size                         | **Verified locally/API:** populated and exact for the probe.                                                                                                          | **Verified API shape; analytical:** normally byte size, but same-byte replacement deliberately preserves it.                                                                                                                                                                        | **Verified API shape; analytical:** even a correct value cannot identify a same-byte replacement.                                                                                                                                                                                                                                                                        |
| SHA-256 digest               | **Verified, platform-independent application computation:** hashes bytes read from the open handle.                                                                   | **Verified application logic:** same computation.                                                                                                                                                                                                                                   | **Verified application logic:** same computation. **Analytical:** digest equality proves byte equality, not object continuity.                                                                                                                                                                                                                                           |
| `mtimeNs` / `ctimeNs`        | **Verified locally/API:** available with bigint stats. The guard uses only within-read equality.                                                                      | **Verified API shape; analytical resolution:** present with bigint stats, but filesystem timestamp resolution and update timing are outside the checked Node contract. Cross-phase changes are ignored anyway.                                                                      | **Verified API shape; unverified runtime semantics:** bigint stats expose the properties, so they are not absent at the Node type level. Their filesystem meaning/resolution was not verified on Windows, and this implementation does not compare them with the original snapshot.                                                                                      |
| `O_NOFOLLOW`                 | **Verified source behavior:** used when the runtime exposes it.                                                                                                       | **Verified source behavior:** same conditional use.                                                                                                                                                                                                                                 | **Unverified availability:** the code explicitly substitutes `0` if absent, so no-follow protection can silently be unavailable; this is a symlink-hardening concern, not the best explanation for the observed same-byte replacement.                                                                                                                                   |

- **Verified:** No field used by the guard is conditionally absent from Node's declared `Stats` or
  `BigIntStats` shape on Windows. The important Windows gap is stronger: this audit found no
  checked Node guarantee that `dev`/`ino`/`nlink` have the durable semantics the decision assumes.
- **Analytical:** Timestamp granularity cannot rescue the current design because initial
  timestamps are discarded. Even perfect nanosecond timestamps only detect mutation during one
  read, not replacement between phases.

## Verdict with confidence

- **Verified:** The guard is content-strong but identity-fragile. SHA-256 and size cover changed
  bytes; `nlink === 1` covers reported hardlink drift; only a reusable/host-defined `(dev, ino)`
  tuple covers identical-byte path replacement.
- **Analytical — Linux mechanism, high confidence but unconfirmed:** immediate inode reuse after the
  original handle is closed explains every successful comparison and the macOS/Linux difference.
  Exact confirmation needs the failing runner's metadata trace or a Linux reproduction.
- **Analytical — Windows exposure, medium confidence:** Windows is plausibly affected because the
  correctness argument depends on file-identity and link-count semantics not established for the
  shipped Windows filesystem/runtime. It is not justified to say Windows is affected, nor to say
  it is safe, without Windows execution.
- **Verified release boundary:** The Darwin-focused run proves only this macOS host. It does not
  close Windows acceptance. Linux should remain evidence about mechanism sensitivity, not be
  reframed as a release target (`TASKS.md:16-20`).

### What remains unverified

- **Verified gap:** which of the two expectations failed in run `31400538426`, and the Linux
  `dev`/`ino`/`nlink`/timestamp values that made it pass.
- **Verified gap:** behavior on Windows x64 and Windows ARM64, on the actual shipped filesystem,
  under the packaged Electron Node runtime. The repository currently declares Electron
  `^37.10.3` and Node `>=22 <25` (`package.json:206,273-275`), but this audit did not execute either
  Windows target.
- **Verified need to close:** split diagnostic executions for replacement and hardlink drift on
  the failing Linux runner; then the same focused file on Windows x64/ARM64, recording path-stat
  and handle-stat fields at creation and after mutation. A packaged smoke should repeat the
  identity capability check under Electron, because a development Node run is not packaged-runtime
  acceptance.

## Options

**Verified scope:** These are design options only. This investigation makes no production or test
change.

1. **Analytical — preferred direction: retain an identity anchor and fail closed.** Keep the
   original inspection handle open across all external phases, and compare each reopened path to
   that live handle. On POSIX-like filesystems, retaining the handle prevents the original inode
   from becoming reusable while the guard needs it. Define the Windows equivalent explicitly and
   block if the runtime cannot provide it. This requires platform validation because Windows
   sharing/deletion rules differ.
2. **Analytical — explicit capability evidence:** Before approval, prove within the actual private
   inspection workspace that the runtime/filesystem can distinguish two same-byte files and report
   a hardlink-count transition. If any required field is missing, sentinel-like, inconsistent, or
   unsupported, emit a typed blocker such as `EVIDENCE_MISSING` instead of treating equality as
   approval. Capability probing alone does not remove races, so it is defense-in-depth rather than
   a replacement for an anchored identity.
3. **Analytical — platform-native identity:** Use a platform adapter that returns a documented,
   full-width file identity and link count (including a Windows-native file ID), with an explicit
   `unsupported` result. Compare that identity while an anchor handle is live. Do not compress an
   unavailable value to zero or an empty tuple.
4. **Analytical — insufficient alone:** Retaining creation `mtimeNs`, `ctimeNs`, or birth time may
   add evidence, but timestamp collisions, filesystem resolution, and host semantics make it an
   unsuitable sole identity. Rehashing is also insufficient because the attack/test preserves
   bytes.
5. **Verified house pattern / analytical application:** BUG-013 rejects missing/invalid lineage
   before packaging and rejects a mismatch rather than continuing
   (`packages/shared-scripts/src/prepare-aioncore.js:148-160`). Bundled-resource verification
   likewise records `missing_file`, `invalid_json`, and `lineage_mismatch` as failures
   (`packages/shared-scripts/src/verify-bundled-aioncore-resources.js:167-194`). BUG-043 should use
   the same direction of trust: **identity proven → continue; identity missing, unsupported, or
   ambiguous → blocker; never ambiguous → approval**.
