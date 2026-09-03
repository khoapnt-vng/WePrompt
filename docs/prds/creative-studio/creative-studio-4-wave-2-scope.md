# Wave 2 — scope and split

> **Corrected 2026-09-03.** The first revision of this document (`c576ff1a4`) was wrong in ways
> that **understated** the work, which is the dangerous direction. Its three load-bearing
> premises — that `v2Service` was live, that video was ~29 hardcodes, and that References was a
> port — are all disproved below. If you planned from the previous revision, re-plan.
>
> Provenance: measured in a worktree at `bd167da50` — a local spike one commit ahead of
> `958478ded` (tip of `codex/creative-studio-4-pilot`), touching only
> `service/pilot/runtime/jobs.ts`, so every claim outside that one file reflects `958478ded`.
> Re-checked against `codex/creative-studio-4-phase-6` (Wave 1). Claims marked **[verified]**
> were re-read directly; claims marked **[audit]** come from a 24-agent adversarial audit and
> were not all independently re-read.

---

## 0. Read this first — a P0 regression, unrelated to Wave 2 scope

**Creating a new Piece from the mounted UI is impossible — every renderer `prepare-photo`
*create* call is rejected at the IPC boundary.** **[verified]**

Scope, stated precisely: only the `create` branch is blocked. The `retry` branch carries no
`referencePieceIds` and its five keys match the renderer exactly
(`PilotCanvas.tsx:702-710`), so retrying an existing Piece still works. Reproduced empirically
against the production `parseNativeBridgePayload`: no field → accepted, empty array → rejected,
one id → rejected.

`common/adapter/native/payloadSchemas.ts:1142-1154` declares the `mode: 'create'` branch of
`'creative-studio-pilot.prepare-photo'` as `.strict()` over exactly six keys — `mode`,
`projectId`, `expectedAuthoringRevision`, `words`, `settings`, `suggestedHandle`. It does not
include `referencePieceIds`. `PilotCanvas.tsx:1031` sends `referencePieceIds` on every call.
A `.strict()` object rejects unknown keys.

The Director path is unaffected, because `service/pilot/director/processor.ts:98` calls
`preparePhotoV3` in-process rather than over IPC. That is why this was not noticed.

This is **not** a fresh oversight: `f962f705e` is five commits behind `958478ded`, so the gap
has been shipped and lived with.

Still unfixed on Wave 1 **[verified]**: the schema on `codex/creative-studio-4-phase-6` has no
`referencePieceIds`, and that branch's `PilotCanvas` still sends it at two sites.

The fix is roughly ten lines — add
`referencePieceIds: z.array(safeIdSchema).max(STUDIO_MAX_PIECE_CONDITIONING_INPUTS_V3)` to the
create branch, and add the field to the fixture at
`tests/unit/process/bridge/nativePayloadSchemas.test.ts:251`.

**The guard matters more than the fix.** The payload-schema fixtures are hand-written next to
the schema, so they agree with it by construction and can never catch a renderer that sends
something else. Derive them from the transported request types, or assert against a real
renderer call. This is what let a nine-layer feature ship while missing its tenth layer.

---

## 1. What was wrong in the previous revision

**"The video adapters are unreachable for route and media-kind reasons, not registration
reasons."** Half right. The registry does construct all four adapters unconditionally
(`adapters/index.ts:33-38`). But they are inert Map entries no production path retrieves; the
real gate is a set of `=== 'weprompt-image-v1'` pins downstream (`connectionController.ts:29`,
`pilotProductionRuntime.ts:244`). **[audit]**

**"The References code is not portable, it is deletable."** The deletion half is right and the
line count was exact — 4,205 lines across seven files. But the framing was wrong: References is
**not** the video story. See §3. **[audit]**

**"~30 gates in `runtime/media.ts`", "24,880 adapt lines", the `29 hardcodes` count.** None of
these is reproducible. They came from counting `'image'` literals, which measures nothing: in
`schema2/validation.ts`, 16 of 17 counted literals are V2 board-path branching that already
coexists with working video, while ~10 genuine Pilot hardcodes in the same file went uncounted.
The count was simultaneously too high and too low. **[audit]**

**"`v2Service` produces video today through the same spine."** False, and this was the
centrepiece. `v2Service.ts` (4,506 lines) is dead: `process/bridge/creativeStudioBridge.ts:26`
states *"No schema-5 provider is registered or imported"* and registers only connections and
pilot. Nothing constructs it. **[verified]**

**File placement.** `validation.ts`, `estimate.ts`, `authorization.ts`, `composition.ts` and
`submissionIdentity.ts` were listed under `service/pilot/`. They live under `service/schema2/`.
The Pilot imports them; it does not own them. **[verified]**

---

## 2. Video — a nine-layer vertical feature, not a gate list

The Pilot is image-only by construction from the tool schema down to the byte-signature check
on every playback read. The layers, each an independent narrowing: **[audit]**

| Layer | Gate |
|---|---|
| MCP tool schema | `pilotStudioServer.ts:131` — `studio_prepare_photo` is the only creation tool, `.strict()`, aspect-ratio + resolution only |
| Director policy | `pilot/director/contracts.ts:26` — union has no motion member |
| Persistence | `StudioPiecePhotoSettingsV3` has no duration; `mediaKind: 'image'` is a **type literal** at `creativeStudioTypes.ts:1894`, `:2109` |
| Validation | `validation.ts:3337` categorically rejects non-image Piece assets |
| Spend identity | `schema2/pricing/authorization.ts:560` derives the authorization id from the literal `'piece_image'` |
| Runtime | `pilot/runtime/jobs.ts:470` rejects `durationSeconds !== 1`; `media.ts:52` image-only MIME allowlist |
| Projections | `projections.ts:380` `mediaKind: 'image' as const` |
| Connection wiring | `pilotProductionRuntime.ts:244` filters connections to `weprompt-image-v1` |
| Renderer | `PilotCanvas.tsx:512` is a bare `<img>` — the only media element on the mounted path |

**It is a *purpose* problem more than a `mediaKind` problem.** `'piece_image'` is woven into
spend identity, so a video purpose could never reproduce a matching authorization id.

**Wave 1 has since frozen the contracts and wired none of them** **[verified]**:
`StudioPieceKindV4 = 'photograph' | 'motion'` exists, `StudioPieceMotionSettingsV4` exists, and
`'piece_motion'` exists as a purpose — but `StudioPieceKindV4` has two usage sites, both inside
the type file; `piece_motion` appears nowhere in `schema2/pricing`; `authorization.ts:560` is
unchanged; and there is still no `studio_prepare_motion` tool.

**Genuinely ready, needing no work:** all four adapters constructed; `rateCardConfig.ts:26-41`
prices all three video adapters at `rateUnit: 'second'` with per-second math in
`schema2/generation/spendMath.ts:59-70`; CSP already allows `media-src 'self' weprompt-studio:`
and the custom protocol already does RFC 7233 range serving; **no ffmpeg is required** to
produce or view one video Piece.

---

## 3. References — wiring, not a port, and not the video story

The semantic workflow was deliberately rebuilt as bounded Piece conditioning in `f962f705e`
(five commits before the audited tip), and is **live on eight of nine layers including the
mounted UI** — `PilotCanvas.tsx:1379-1415` already ships a full reference picker. **[audit]**

**One caveat that is the closest thing here to the video narrowing**: route admission checks
the conditioning constraint correctly, but conditioning capacity is **fail-closed to a single
hardcoded provider+model tuple** in production (`common/utils/imageModelAllowlist.ts:69-74`).
The wiring is right; the admitted set is one. **[audit]**

The single blocker is the IPC omission in §0. It is not a References enhancement; it is a P0
regression that breaks the whole composer.

**Unlike video, there is no spend-identity hazard**: `pilot/prepare.ts:233-235` *mints* the
authorization identity rather than deriving it from a purpose literal.

**The 4,205 dead lines are deletable** — `referenceSidecars.ts` 2222, `referenceViewAdapter.ts`
870, `studioReferenceRequestWriter.ts` 694, `referenceRemovalBlockers.ts` 271,
`referenceBinding.ts` 83, `referenceRequest.ts` 50, `referenceStatus.ts` 15.

**The `spendOrchestration` hazard was a false alarm** — recorded so nobody re-raises it. The
file is `renderer/pages/studio/StudioPage/spendOrchestration.ts` (not `service/`); it does
value-import and call `referenceCapabilityItems` at `:634` and `:746`; but it is itself
unreachable — its only importer is `mediaViewAdapters.ts:38`, which has no importer, and
`StudioPage/index.tsx` references none of the three. It is a **closed cycle of dead modules**.
Delete the cluster whole, or not at all: removing one member breaks the build via the others.
**[verified]**

---

## 4. Export — not narrowed out; whole-project export is what went

Per-Piece export is genuinely wired end to end: real image bytes plus a provenance manifest, a
native save dialog, and reveal-in-Finder. What disappeared with the cutover is **whole-project /
film export**, not the ability to get work out. **[audit]**

Three corrections a reader needs:

- **It is behind an off-by-default flag.** Every export command short-circuits unless
  `AIONUI_ENABLE_CREATIVE_STUDIO === '1'`. "Live" means "live when enabled".
- **Reveal opens the wrong folder.** Export copies to the user's chosen destination, but
  `resolveRevealPath` recomputes a path inside the app's confined store root and reveals that.
- **Eight orphaned IPC channels remain declared** at `ipcBridge.ts:1432-1457` (`createExport`,
  `getFilmExportCapability`, `getFilmExportStatus`, `cancelFilmExport`, …) with no registered
  provider, and a still-present renderer hook invokes two of them.

Wave 1 has since added `pilot/runtime/export.ts` and `schema2/exports/pieceManifestV4.ts`, so
export work has migrated into Wave 1 regardless of what this document says. **[verified]**

Note for anyone deleting the old export modules: only `filmExporter.ts` is genuinely
unreachable. `catalog.ts` and `editorFolder.ts` are re-exported by a barrel that **is** on the
live path.

---

## 5. Sound — narrowed out, but by an explicit decision

Audio was real and live before CS4 — imported music bed, shot audio analysis, clip-audio
playback, film-export audio mix — and was removed wholesale in `1a8db2713`. Nothing survives on
the Pilot path. **[audit]**

I previously framed this as "a written decision, unlike video". **That contrast does not
hold**: the scope documents name sound and video in the *same sentences*, with equal
explicitness. What actually separates them is prior machinery — video had a live rate-card
kind, live adapters and a real generation purpose; sound had none.

A *generatable* sound Piece never existed in any version, so that specific thing is a
first-ever build rather than a restoration. Wave 1 added a sound addendum PRD and a designer
delivery; no code.

---

## 6. The parity gap, stated properly

The clearest measure is the tool diff. `scripts/build-mcp-servers.js:52` builds
`builtin-mcp-studio.js` from `pilotStudioServer.ts`, so that file is what ships;
`studioServer.ts` is dead, surviving only in the coverage config. **[verified]**

Shipping today: `get_project_status`, `prepare_photo`, `rename_piece`, `get_command_status`,
and Wave 1's new `propose_board`.

Declared in the dead server and absent from the Pilot — the parity gap, in product terms:

| Lost tool | What the Director can no longer do |
|---|---|
| `studio_request_reference_images` | ask for references |
| `studio_apply_edits` | edit existing work |
| `studio_apply_free_fix` | retry without charging |
| `studio_get_conditioning_frame` | use a frame as conditioning |
| `studio_list_routes` | see or choose a model route |
| `studio_propose_paid_recovery` | offer a paid recovery after failure |
| `studio_get_proposal` | read back a proposal |

---

## 7. What this means for Wave 2

**Wave 2 as originally scoped — "References and video Pieces" — is no longer a coherent unit.**

- References is not a port. It is a ten-line IPC fix (which is a P0 in its own right) plus a
  separately-scoped deletion of 4,205 dead lines.
- Video's contracts landed in Wave 1. Splitting the wiring into a separate wave means handing
  off mid-feature, immediately after the contract work that gives it context.
- Export already migrated into Wave 1.
- Sound is a feature build, and partly a first-ever build.

**Recommendation.** Fold the video wiring into Wave 1's tail while the contract context is
fresh; treat the §0 regression as immediate and unrelated to wave planning; scope the remaining
work around the seven lost tools in §6 rather than around waves, since each is a demonstrable
capability with a clear done condition.

**The decision this depends on** is whether CS4 is a stills product — in which case Wave 1 plus
export is close to done — or a parity product, in which case §6 is the roadmap. Wave 2 as
written straddles both and commits to neither.

---

## 8. Method note

Both errors in the first revision came from the same habit: counting literals and reading
names instead of tracing reachability. The rules that would have prevented them:

1. **Never report a bare count as a size.** Distinguish a hardcode from a mention.
2. **Prove liveness before citing code as evidence.** `v2Service.ts` looks fully featured and
   runs nowhere.
3. **Trace the vertical slice**, tool schema to rendered element. Nine layers each looked
   locally reasonable while the tenth silently rejected every call.
