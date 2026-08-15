# Sprint 3 Selected-Fix Audit

The RC remains rooted at WePrompt `634f49c21567d9bd987b04887eaa0c6126b86353`. The named commits below were fetched and reviewed as objects. None is an ancestor of the RC, and this audit does not authorize merging or rebasing onto `main`.

Focused baseline evidence on the RC:

- Auth transport: 97 tests passed across `localBackendAuth`, `httpBridge`, `PresentationRuntimeEventClient`, and `speechStreamClient.dom`.
- Office and packaging: 189 tests passed and 4 skipped across `officeCliRunner`, `OfficeArtifactService`, `releasePackagingConfig`, `buildWithBuilder`, and `updatePolicy`.
- The Task 1 full suite passed 8,209 tests with the ordered attempt retained separately.

## Decisions

### `8c66c75acf59627e91ac96dd25f7a0925d8151c4` — live WebSocket authentication

- Changed paths: `httpBridge.ts`, `PresentationRuntimeEventClient.ts`, `SpeechStreamClient.ts`, and their focused tests.
- Assumptions: WebSocket subprotocol authentication is accepted by the target backend; the STT route does not reject the request in generic HTTP auth middleware first.
- Baseline evidence: the RC already contains `44f00a112d3a6a6548f9785d1742f7d0aadc4093`, which injects `Authorization: Bearer` only for the current local-backend origin and only from app-shell web contents. Presentation runtime also supplies `localTokenAuthHeaders`. This covers browser WebSockets, EventSource/image requests, and STT before route-specific subprotocol handling.
- Smallest complete patch: none. The RC transport is narrower than a persisted cookie and covers the generic middleware boundary that the later STT subprotocol alone does not.
- Focused evidence: 97/97 passed.
- Decision: `replaced` by the scoped main-process credential injection already in the RC.

### `95d8dd4eda8cbf7b147d40ec521cd43f351e5e42` — headerless requests/session cookie

- Changed paths: `packages/desktop/src/index.ts` plus unrelated formatting in `WeixinConfigForm.tsx`.
- Assumptions: a session cookie may be persisted broadly enough for headerless local-backend requests without creating a wider credential surface.
- Baseline evidence: the RC origin- and webContents-scoped header injection covers the required headerless request types without persisting a bearer-equivalent cookie. The unrelated form formatting has no release-contract need.
- Smallest complete patch: none.
- Focused evidence: included in the 97/97 auth run.
- Decision: `replaced` by `44f00a112d3a6a6548f9785d1742f7d0aadc4093`; unrelated formatting is excluded.

### `1a310731b37d7ccd5a2c31eba0b83821b855d017` — OfficeCLI packaged resolution

- Changed paths: `officeCliRunner.ts`, `OfficeArtifactService.ts`, and `officeCliRunner.test.ts`.
- Assumptions: the packaged backend root is `resources/bundled-aioncore/<platform>-<arch>` and OfficeCLI is carried at `managed-resources/office/officecli[.exe]`.
- Baseline evidence: exact equivalent behavior and tests were forward-ported through `0b4b5d1ef` and folded into the approved baseline by `634f49c21`. The runner checks the packaged path and the Windows `LOCALAPPDATA` install path; the service preserves `OFFICECLI_NOT_FOUND` instead of misclassifying the document.
- Smallest complete patch: none.
- Focused evidence: Office/packaging run passed 189 tests with 4 skipped.
- Decision: `already present`.

### `642665720a455b1cd9963936ba877eb640dbb5e2` — OfficeCLI asset generation

- Changed paths: `packages/shared-scripts/src/prepare-aioncore.js` and `tests/unit/assets/officecliAssetName.test.ts`.
- Assumptions: WePrompt may independently download OfficeCLI `v1.0.143` while preparing each desktop build, and adding files after backend-contract validation still produces one trustworthy bundle.
- Baseline evidence: the current AionCore release candidate exports Node and ACP managed resources but not OfficeCLI. Therefore the packaged-path behavior above would otherwise fall back to host installation or `PATH` on a clean machine.
- Smallest complete patch: add the pinned OfficeCLI asset and digest to the immutable AionCore release bundle before its manifest and checksums are generated. WePrompt must consume that already-verified bundle and must not download a second executable.
- Focused evidence: AionCore `232456db3d2ade5933952f1463a5af977e135a15` implements the replacement. Release-contract tests passed 30/30; the official ARM64 asset matched its pinned digest; and the independent verifier accepted an 11,791-file ARM64 smoke bundle containing `managed-resources/office/officecli`. Native Windows evidence remains required.
- Decision: `replaced` by the complete AionCore bundle contract at `232456db3d2ade5933952f1463a5af977e135a15`.

### `c2c7de28678e67e11bb2cb5b9f883b0b2ad11e48` — presentation-template packaging path

- Changed path: `packages/desktop/electron-builder.yml`.
- Assumptions: template sources live under `packages/desktop/resources/presentation-templates` and runtime packaging copies them to `presentation-templates`.
- Baseline evidence: the RC already uses that package-qualified source through `eff4cbb14`; `releasePackagingConfig.test.ts` rejects the old repo-root path and verifies manifest inventory.
- Smallest complete patch: none.
- Focused evidence: included in the 189-test Office/packaging run.
- Decision: `already present`.

### `7820b7f9393588edf91011ab86838363e5c872c0` — standalone Windows build workflow

- Changed path: new `.github/workflows/build-weprompt-win.yml`.
- Assumptions: Windows should compile AionCore from a mutable input ref with Rust 1.95, then locally assemble the backend before packaging; Actions and Bun may use mutable version labels.
- Baseline evidence: the accepted release architecture consumes immutable published AionCore bundles, pins action SHAs and tool versions, binds hashes/lineage to evidence, and requires two target jobs in one RC workflow. The candidate does none of those completely.
- Smallest complete patch: the dedicated two-target `sprint3-internal-rc.yml` release workflow defined by Task 6, with Windows first and no backend source build.
- Focused evidence: workflow contract tests will be added with Task 6.
- Decision: `replaced` by the two-target immutable-bundle workflow.

### `4865c1ef04d881e750f40fb76dc0330989973972` — mixed Windows/release changes

- Changed paths: `package.json`, `packages/desktop/src/index.ts`, four NSIS include files, `scripts/prepareMcpBundle.js`, and `prepareMcpBundle.test.ts`.
- Assumptions: the whole mixed commit applies to the RC and an unconditional `resources/mcp-bundled` builder entry still exists.
- Baseline evidence: `productName` is already `WePrompt`; the RC has stronger current/legacy executable handling in NSIS; release update policy is fail-closed unless a safe product-owned feed exists; and neither the obsolete MCP script nor an unconditional `mcp-bundled` resource entry exists in the RC.
- Smallest complete patch: no candidate hunk. Task 4 will assert the accepted internal-release update and Studio policy; Task 6 will retain the RC's stronger NSIS behavior.
- Focused evidence: `buildWithBuilder` and `updatePolicy` passed in the 189-test run.
- Decision: `replaced` by existing RC behavior plus the explicit Task 4 release assertion.

### `8cafd02c4b30fc6081ff50f82869bfa22a30ea54` — Windows workflow formatting

- Changed path: only `.github/workflows/build-weprompt-win.yml` from `7820b7f93`.
- Assumptions: the candidate workflow is retained.
- Baseline evidence: that workflow is replaced, so formatting-only changes to it carry no independent behavior.
- Smallest complete patch: none; format the Task 6 workflow under the RC formatter.
- Focused evidence: Task 6 format and workflow-contract gates.
- Decision: `excluded` as dependent formatting for a replaced file.

### `6e6b0834c01ac2669910499981e16f80aba38053` — Strawberry Perl/OpenSSL source build

- Changed path: `.github/workflows/build-weprompt-win.yml`.
- Assumptions: WePrompt compiles the Rust backend and vendored OpenSSL on the Windows packaging runner.
- Baseline evidence: the release architecture downloads and verifies the already-built AionCore Windows bundle; WePrompt does not compile Rust/OpenSSL.
- Smallest complete patch: none. Strawberry Perl remains an AionCore build-pipeline concern, where it is already installed in the AionCore release workflow.
- Focused evidence: AionCore Windows release build and WePrompt Task 6 workflow-contract gates.
- Decision: `replaced` by the separated AionCore build pipeline.

### `371f0875b8ae8481a3d7a3ec27e4340ea1e49eb0` — builder runtime compatibility

- Changed paths: `package.json` and `bun.lock`.
- Assumptions: `builder-util-runtime` 9.7.0 must match Electron Builder's runtime protocol.
- Baseline evidence: both RC dependency declarations and the lock resolve 9.7.0 through earlier commit `4431defd64`; `releasePackagingConfig.test.ts` asserts the version and runtime API.
- Smallest complete patch: none.
- Focused evidence: included in the 189-test Office/packaging run.
- Decision: `already present`.

### `7a4c3cc79eb8ead27141d5af82a623231785786f` — macOS signing/notarization

- Changed paths: `scripts/afterPack.js` and `afterPackSigning.test.ts`.
- Assumptions: a signing identity and notarized distribution are in scope.
- Baseline evidence: this is an explicitly unsigned internal release. The commit contains no independently required non-signing hunk.
- Smallest complete patch: none.
- Focused evidence: accepted scope decision.
- Decision: `excluded`.

## Port boundary

No WePrompt code port is approved from these named commits. Tasks 4 and 6 implement the separately specified release-policy and workflow contracts. AionCore `232456db3d2ade5933952f1463a5af977e135a15` now carries pinned OfficeCLI, but publication remains blocked on independent review, native Windows evidence, the retained red suite attempt, and explicit authorization.
