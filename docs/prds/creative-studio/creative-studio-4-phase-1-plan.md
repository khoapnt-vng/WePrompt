# CS4 Phase 1 — Contracts for a standalone Piece

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a standalone photograph representable, persistable and generatable in the Creative
Studio store — with no UI, no canvas and no Director changes.

**Architecture:** Add a third owner kind, `StudioPieceV2`, beside `beats`/`shots`/`references` on the
project. It mirrors `StudioProjectReferenceV2` exactly (id, current asset, superseded list, ordered
`jobIds`, timestamps) plus a handle. A third arm on `StudioGenerationTargetV2` lets a job target it,
and the asset validator is widened to admit a piece-owned image. The persisted project schema stays
at **5** via decode-time defaulting; two independent contracts version.

**Tech Stack:** TypeScript (strict off — `strictNullChecks` is disabled), Vitest 4, Bun, oxfmt,
oxlint. Main-process only. No renderer, no locale keys, no Arco.

---

## Read first

- [The CS4 design, revision 2](./creative-studio-4-canvas-design.md) — especially _Pending work: no
  new record, one new owner_, and _Which contracts version, and which do not_.
- [The wireframe](./creative-studio-4-canvas-wireframe.html.txt) — for what this is eventually for.
  Nothing in it is built here.
- `AGENTS.md` — process boundaries, commit format, and **never add AI signatures**.

**Two facts that will otherwise cost you an hour.**

1. `validateJob` requires an **exact key set**: 24 required keys, exactly two optional
   (`remoteStartedAt`, `progress`). `validateProject` likewise. Adding a field without updating the
   key set fails validation with no useful message.
2. `STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION` requires **exact equality at load**, and a mismatch
   **quarantines the project**. Do not touch it. It stays at 1.

---

## File structure

| File                                                               | Responsibility             | Change                                                                                                 |
| ------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/desktop/src/common/types/project/creativeStudioTypes.ts` | The shared contract        | Add `StudioPieceV2`, the `pieces`/`pieceOrder` project fields, the third target arm; bump two versions |
| `.../creative-studio/service/schema2/validation.ts`                | Persisted-shape validation | Validate pieces; widen asset ownership; extend the target biconditional                                |
| `.../creative-studio/service/schema2/factories.ts`                 | New-project construction   | Seed `pieces: {}` and `pieceOrder: []`                                                                 |
| `.../creative-studio/store.ts`                                     | Load/decode                | Decode-time defaulting so schema stays 5                                                               |
| `.../creative-studio/jobManager.ts`                                | Job ownership              | Third branch in `activeOwnerForJobV2`                                                                  |
| `tests/unit/process/creative-studio/service/pieces.test.ts`        | New                        | The whole contract, tested                                                                             |

---

## Task 0: The shared test harness

Every later task uses these. Written once, here, because repeating them per task would drift.

**Files:**

- Create: `tests/unit/process/creative-studio/service/pieces.test.ts`

- [ ] **Step 1: Write the harness**

These are the repository's real APIs — `createEmptyStudioProjectV2(input, id, timestamp)` from
`schema2/factories`, and `applyStudioMutationBatchV2(project, batch, context)` from
`schema2/mutations`. There is no `createEmptyStudioProjectV2` and no `applyMutations`.

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type {
  CreateStudioProjectInputV2,
  StudioJobV2,
  StudioMutationOperationV2,
  StudioProjectV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  STUDIO_PIECE_KINDS,
  derivedPieceHandle,
} from '@/common/types/project/creativeStudioTypes';
import { createEmptyStudioProjectV2 } from '@process/services/creative-studio/service/schema2/factories';
import { applyStudioMutationBatchV2 } from '@process/services/creative-studio/service/schema2/mutations';
const NOW = '2026-08-30T12:00:00.000Z';

const makeInputV2 = (name: string): CreateStudioProjectInputV2 => ({
  name,
  brief: 'A bounded schema-2 project',
  aspectRatio: '16:9',
  targetDurationSeconds: 12,
  resolution: '1080p',
});

/** A fresh, valid project. `createEmptyStudioProjectV2` takes the id and timestamp explicitly. */
const emptyProject = (): StudioProjectV2 => createEmptyStudioProjectV2(makeInputV2('Pilot'), 'project_v2', NOW);

/** Apply operations and return the next project, throwing on refusal. */
const applyOps = (project: StudioProjectV2, operations: StudioMutationOperationV2[]): StudioProjectV2 => {
  const result = applyStudioMutationBatchV2(
    project,
    {
      schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
      projectId: project.id,
      expectedRevision: project.revision,
      operations,
    },
    { mutationId: 'mutation_1', capturedAt: NOW }
  );
  return result.project;
};

/** A project holding exactly one photograph Piece, `piece_a`, handle `salt_flat`. */
const projectWithOnePiece = (): StudioProjectV2 =>
  applyOps(emptyProject(), [
    { kind: 'create_piece', pieceId: 'piece_a', kindOfPiece: 'photograph', fromWords: 'salt flat' },
  ]);

/**
 * A job targeting a Piece. The 24 required keys are spelled out because `validateJob` enforces an
 * exact key set — omitting one fails validation with no useful message.
 */
const pieceJob = (
  project: StudioProjectV2,
  overrides: { purpose?: StudioJobV2['purpose']; pieceId?: string; status?: StudioJobV2['status'] } = {}
): StudioJobV2 => ({
  id: 'job_1',
  target: { kind: 'piece', pieceId: overrides.pieceId ?? 'piece_a' },
  purpose: overrides.purpose ?? 'seed_still',
  status: overrides.status ?? 'queued_local',
  providerId: 'weprompt-image-v1',
  adapterId: 'weprompt-image-v1',
  model: 'test-model',
  requestSnapshot: null,
  composition: null,
  compositionDigest: null,
  providerJobId: null,
  remoteStartedAt: undefined,
  progress: undefined,
  spendReceipt: null,
  authorizationId: null,
  authorizationItemId: null,
  outputAssetIdsByRole: { primary: null, poster: null },
  error: null,
  attempt: 1,
  createdAt: NOW,
  updatedAt: NOW,
  projectRevision: project.revision,
  conditioningInput: null,
  cancellationPolicy: 'cancellable',
  idempotencyKey: 'idem_1',
});

/** An image asset owned by a Piece. */
const pieceAsset = (project: StudioProjectV2, options: { collection: 'assets' | 'imports'; pieceId?: string }) => ({
  id: 'asset_1',
  shotId: null,
  projectReferenceId: null,
  pieceId: options.pieceId ?? 'piece_a',
  mediaKind: 'image' as const,
  mimeType: 'image/png',
  managedAsset: { collection: options.collection, fileName: 'asset_1.png' },
  sha256: 'a'.repeat(64),
  byteLength: 1024,
  producerJobId: options.collection === 'assets' ? 'job_1' : null,
  compositionDigest: options.collection === 'assets' ? 'b'.repeat(64) : null,
  generationReferenceAssetIds: [],
  createdAt: NOW,
});

/** A project whose Piece has a job still in flight, for the delete guard. */
const projectWithRunningPieceJob = (): StudioProjectV2 => {
  const project = projectWithOnePiece();
  const job = pieceJob(project, { status: 'running' });
  return {
    ...project,
    jobs: { [job.id]: job },
    pieces: { ...project.pieces, piece_a: { ...project.pieces.piece_a!, jobIds: [job.id] } },
  };
};
```

> **Before writing a line of this, open one existing test and copy its job and asset literals** —
> `tests/unit/process/creative-studio/service/directorCommandSpendFence.test.ts` is a good one. The
> field lists above are correct at the time of writing, but the exact key set is enforced and it moves.
> If `validateStudioProjectV2` returns false and you cannot see why, a missing or extra key is the
> first thing to check.

- [ ] **Step 2: Confirm the harness compiles against an unchanged repo**

Run: `bunx tsc --noEmit`
Expected: errors only for `create_piece`, `pieceId` and `STUDIO_PIECE_KINDS`, which Tasks 1–6 add.
Any _other_ error means a field above has drifted — fix the harness, not the type.

- [ ] **Step 3: Commit the harness**

```bash
git add tests/unit/process/creative-studio/service/pieces.test.ts
git commit -m "test(studio): add the Piece contract test harness"
```

---

## Task 1: The `StudioPieceV2` type

**Files:**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts` (after
  `StudioProjectReferenceV2`, which ends at line 488)
- Test: `tests/unit/process/creative-studio/service/pieces.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { STUDIO_PIECE_KINDS, derivedPieceHandle } from '@/common/types/project/creativeStudioTypes';

describe('StudioPieceV2', () => {
  it('admits exactly the kinds Pilot 1 supports', () => {
    // Photograph only. Video, sound and assemblies arrive in phase 6; adding them here would let a
    // job target a kind nothing downstream can produce.
    expect([...STUDIO_PIECE_KINDS]).toEqual(['photograph']);
  });

  it('derives a handle that is never blank, lowercase, and underscore-separated', () => {
    expect(derivedPieceHandle('A salt flat at dawn, one figure walking away')).toBe('a_salt_flat_at_dawn');
    expect(derivedPieceHandle('   ')).toBe('untitled');
    expect(derivedPieceHandle('Ана идёт')).toBe('untitled');
  });

  it('bounds a derived handle so a long sentence cannot become a long identifier', () => {
    const handle = derivedPieceHandle('a'.repeat(400));
    expect(handle.length).toBeLessThanOrEqual(48);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run tests/unit/process/creative-studio/service/pieces.test.ts`
Expected: FAIL — `STUDIO_PIECE_KINDS` is not exported.

- [ ] **Step 3: Add the type and the handle derivation**

In `creativeStudioTypes.ts`, immediately after `StudioProjectReferenceV2` (line 488):

```ts
/** Pilot 1 makes photographs only. Phase 6 adds video, sound and assemblies. */
export const STUDIO_PIECE_KINDS = ['photograph'] as const;
export type StudioPieceKindV2 = (typeof STUDIO_PIECE_KINDS)[number];

/**
 * A first-class thing a capability produced, owned by the project rather than by a Shot.
 *
 * Mirrors `StudioProjectReferenceV2` deliberately: same current-asset pointer, same superseded list,
 * same ordered `jobIds`. The difference is that a Reference is a typed film-craft slot — character or
 * background — and a Piece is whatever a person asked for. That is why a standalone photograph could
 * not simply reuse a Reference.
 */
export type StudioPieceV2 = {
  id: string;
  /** Never blank. Derived at birth; `handleIsDerived` says whether a person has adopted it. */
  handle: string;
  handleIsDerived: boolean;
  /** Kept so a renamed handle stays a valid reference in conversation. */
  priorHandles: string[];
  kind: StudioPieceKindV2;
  currentAssetId: string | null;
  supersededAssetIds: string[];
  jobIds: string[];
  createdAt: string;
  updatedAt: string;
};

const PIECE_HANDLE_MAX = 48;

/**
 * A handle from the words that caused the Piece. ASCII-only on purpose: a handle is typed back at the
 * Director in chat and appears in `#handle` form, so it must survive a keyboard that does not have
 * the author's script. A name that derives to nothing becomes `untitled`, never blank.
 */
export const derivedPieceHandle = (source: string): string => {
  const slug = source
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  if (slug === '') return 'untitled';
  const words = slug.split('_').filter(Boolean);
  let handle = '';
  for (const word of words) {
    const next = handle === '' ? word : `${handle}_${word}`;
    if (next.length > PIECE_HANDLE_MAX) break;
    handle = next;
  }
  return handle === '' ? words[0]!.slice(0, PIECE_HANDLE_MAX) : handle;
};
```

- [ ] **Step 4: Run the test again**

Run: `bunx vitest run tests/unit/process/creative-studio/service/pieces.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
bunx tsc --noEmit
bun run format
git add packages/desktop/src/common/types/project/creativeStudioTypes.ts tests/unit/process/creative-studio/service/pieces.test.ts
git commit -m "feat(studio): add the StudioPieceV2 contract and handle derivation"
```

---

## Task 2: `pieces` on the project, with the schema staying at 5

**Files:**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts:1629-1635` (the owner maps)
- Modify: `.../creative-studio/service/schema2/factories.ts`
- Modify: `.../creative-studio/service/schema2/validation.ts:114` (`PROJECT_REQUIRED_KEYS`)
- Test: `tests/unit/process/creative-studio/service/pieces.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the same test file:

```ts
describe('pieces on the project', () => {
  it('a new project starts with no pieces and still validates', () => {
    const project = emptyProject();
    expect(project.pieces).toEqual({});
    expect(project.pieceOrder).toEqual([]);
    expect(validateStudioProjectV2(project)).toBe(true);
  });

  it('rejects a pieceOrder entry with no piece behind it', () => {
    // Order and map must agree, exactly as beatOrder/beats and referenceOrder/references do.
    const project = emptyProject();
    expect(validateStudioProjectV2({ ...project, pieceOrder: ['piece_missing'] })).toBe(false);
  });

  it('rejects two pieces sharing a handle', () => {
    // A handle is how a person and the Director refer to a Piece. Two of them is an ambiguous
    // reference, which is worse than an ugly name.
    const project = emptyProject();
    const piece = {
      id: 'piece_a',
      handle: 'salt_flat',
      handleIsDerived: true,
      priorHandles: [],
      kind: 'photograph' as const,
      currentAssetId: null,
      supersededAssetIds: [],
      jobIds: [],
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    const clash = { ...piece, id: 'piece_b' };
    expect(
      validateStudioProjectV2({
        ...project,
        pieceOrder: ['piece_a', 'piece_b'],
        pieces: { piece_a: piece, piece_b: clash },
      })
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run tests/unit/process/creative-studio/service/pieces.test.ts -t 'pieces on the project'`
Expected: FAIL — `project.pieces` is undefined.

- [ ] **Step 3: Add the fields**

In `creativeStudioTypes.ts`, immediately after `references: Record<string, StudioProjectReferenceV2>;`
(line 1634):

```ts
  pieceOrder: string[];
  pieces: Record<string, StudioPieceV2>;
```

In `factories.ts`, inside `createEmptyStudioProjectV2`'s project literal, beside `references: {}`:

```ts
  pieceOrder: [],
  pieces: {},
```

In `validation.ts`, add `'pieceOrder'` and `'pieces'` to `PROJECT_REQUIRED_KEYS` (line 114).

- [ ] **Step 4: Add the piece validator**

In `validation.ts`, beside the other record validators:

```ts
const PIECE_REQUIRED_KEYS = new Set([
  'id',
  'handle',
  'handleIsDerived',
  'priorHandles',
  'kind',
  'currentAssetId',
  'supersededAssetIds',
  'jobIds',
  'createdAt',
  'updatedAt',
]);

const PIECE_HANDLE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/u;

const validatePiece = (value: unknown): boolean => {
  if (!isRecord(value) || !hasKeys(value, PIECE_REQUIRED_KEYS, new Set())) return false;
  return (
    isSafeId(value.id) &&
    typeof value.handle === 'string' &&
    value.handle.length > 0 &&
    value.handle.length <= 48 &&
    PIECE_HANDLE_PATTERN.test(value.handle) &&
    typeof value.handleIsDerived === 'boolean' &&
    Array.isArray(value.priorHandles) &&
    value.priorHandles.every((one) => typeof one === 'string' && PIECE_HANDLE_PATTERN.test(one)) &&
    STUDIO_PIECE_KINDS.includes(value.kind as StudioPieceKindV2) &&
    (value.currentAssetId === null || isSafeId(value.currentAssetId)) &&
    Array.isArray(value.supersededAssetIds) &&
    value.supersededAssetIds.every(isSafeId) &&
    Array.isArray(value.jobIds) &&
    value.jobIds.every(isSafeId) &&
    isCanonicalIsoTimestamp(value.createdAt) &&
    isCanonicalIsoTimestamp(value.updatedAt)
  );
};
```

Then inside `validateStudioProjectV2`, beside the `references`/`referenceOrder` checks:

```ts
if (!isRecord(value.pieces) || !Array.isArray(value.pieceOrder)) return false;
if (!Object.values(value.pieces).every(validatePiece)) return false;
if (!value.pieceOrder.every((id) => isSafeId(id) && ownValue(value.pieces, id) !== undefined)) return false;
if (new Set(value.pieceOrder).size !== value.pieceOrder.length) return false;
if (Object.keys(value.pieces).length !== value.pieceOrder.length) return false;
{
  const handles = Object.values(value.pieces).map((piece) => (piece as StudioPieceV2).handle);
  if (new Set(handles).size !== handles.length) return false;
}
```

- [ ] **Step 5: Add decode-time defaulting so the schema stays at 5**

In `store.ts`, where a loaded project record is decoded — before it reaches
`validateStudioProjectV2` — default the two new fields:

```ts
// The persisted schema stays at 5. A project written before pieces existed simply has none, and
// defaulting here is cheaper and safer than a version bump, because a bump would make every
// existing record fail an exact-equality check and quarantine the project.
const withPieces = {
  ...decoded,
  pieceOrder: Array.isArray(decoded.pieceOrder) ? decoded.pieceOrder : [],
  pieces: isRecord(decoded.pieces) ? decoded.pieces : {},
};
```

- [ ] **Step 6: Run the tests**

Run: `bunx vitest run tests/unit/process/creative-studio/service/pieces.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Run the whole store suite — this is a schema change**

Run: `bunx vitest run tests/unit/process/creative-studio/`
Expected: PASS. If a fixture fails on the exact key set, add `pieceOrder`/`pieces` to that fixture;
do not relax `hasKeys`.

- [ ] **Step 8: Commit**

```bash
bunx tsc --noEmit
bun run format
git add packages/desktop/src tests/unit/process/creative-studio
git commit -m "feat(studio): own pieces on the project, with the schema held at 5"
```

---

## Task 3: A job can target a Piece

**Files:**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts:552`
- Modify: `.../creative-studio/service/schema2/validation.ts:1103` (the purpose biconditional)
- Test: `tests/unit/process/creative-studio/service/pieces.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('a job can target a Piece', () => {
  it('admits a piece target whose purpose is seed_still', () => {
    const project = projectWithOnePiece();
    const job = pieceJob(project, { purpose: 'seed_still' });
    expect(validateStudioProjectV2({ ...project, jobs: { [job.id]: job } })).toBe(true);
  });

  it('refuses a piece target whose purpose is reference_image', () => {
    // reference_image is bound to a Reference by a biconditional in three validators plus the
    // confirm builder. A Piece is not a Reference, and blurring that would let a photograph be
    // written into a character look-sheet slot.
    const project = projectWithOnePiece();
    const job = pieceJob(project, { purpose: 'reference_image' });
    expect(validateStudioProjectV2({ ...project, jobs: { [job.id]: job } })).toBe(false);
  });

  it('refuses a piece target naming a piece that does not exist', () => {
    const project = projectWithOnePiece();
    const job = pieceJob(project, { purpose: 'seed_still', pieceId: 'piece_absent' });
    expect(validateStudioProjectV2({ ...project, jobs: { [job.id]: job } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `bunx vitest run tests/unit/process/creative-studio/service/pieces.test.ts -t 'target a Piece'`
Expected: FAIL — the target union has no `piece` arm.

- [ ] **Step 3: Add the third arm**

In `creativeStudioTypes.ts:552`, replace:

```ts
export type StudioGenerationTargetV2 = { kind: 'shot'; shotId: string } | { kind: 'reference'; referenceId: string };
```

with:

```ts
export type StudioGenerationTargetV2 =
  | { kind: 'shot'; shotId: string }
  | { kind: 'reference'; referenceId: string }
  | { kind: 'piece'; pieceId: string };
```

- [ ] **Step 4: Extend the biconditional rather than loosening it**

In `validation.ts:1103`, the current job rule is:

```ts
(value.purpose === 'reference_image') === (isRecord(value.target) && value.target.kind === 'reference') &&
```

Keep it exactly as it is — it is still true, because a Piece never carries `reference_image`. Add,
beside it, the piece-target rule:

```ts
      (!isRecord(value.target) ||
        value.target.kind !== 'piece' ||
        (value.purpose === 'seed_still' && isSafeId(value.target.pieceId))) &&
```

- [ ] **Step 5: Validate the target resolves**

In `validateStudioProjectV2`, where shot and reference targets are already resolved against their
maps, add:

```ts
if (job.target.kind === 'piece' && ownValue(value.pieces, job.target.pieceId) === undefined) return false;
```

- [ ] **Step 6: Run the tests**

Run: `bunx vitest run tests/unit/process/creative-studio/service/pieces.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
bunx tsc --noEmit && bun run format
git add packages/desktop/src tests/unit/process/creative-studio
git commit -m "feat(studio): let a generation job target a Piece"
```

---

## Task 4: A Piece can own an image asset

**Files:**

- Modify: `.../creative-studio/service/schema2/validation.ts:753-781`
- Test: `tests/unit/process/creative-studio/service/pieces.test.ts`

This is the real gate. Today a shot-less image **must** carry a `projectReferenceId`, a shot-less
non-image asset is rejected outright, and ownership is an exclusive XOR.

- [ ] **Step 1: Write the failing test**

```ts
describe('a Piece can own an image asset', () => {
  it('admits a piece-owned generated image', () => {
    const project = projectWithOnePiece();
    const asset = pieceAsset(project, { collection: 'assets' });
    expect(validateStudioProjectV2({ ...project, assets: { [asset.id]: asset } })).toBe(true);
  });

  it('admits a piece-owned imported image with no producer', () => {
    // An import is a Piece too: it exists because a person made it. It must carry no producerJobId,
    // no compositionDigest and no generation references, exactly as an imported reference must not.
    const project = projectWithOnePiece();
    const asset = pieceAsset(project, { collection: 'imports' });
    expect(validateStudioProjectV2({ ...project, assets: { [asset.id]: asset } })).toBe(true);
  });

  it('refuses an asset owned by both a Piece and a Shot', () => {
    const project = projectWithOnePiece();
    const asset = { ...pieceAsset(project, { collection: 'assets' }), shotId: 'shot_1' };
    expect(validateStudioProjectV2({ ...project, assets: { [asset.id]: asset } })).toBe(false);
  });

  it('refuses a piece-owned asset that is not an image', () => {
    // Pilot 1 is photographs. Video and sound Pieces arrive in phase 6 with their own validation.
    const project = projectWithOnePiece();
    const asset = { ...pieceAsset(project, { collection: 'assets' }), mediaKind: 'video' as const };
    expect(validateStudioProjectV2({ ...project, assets: { [asset.id]: asset } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch all four fail**

Run: `bunx vitest run tests/unit/process/creative-studio/service/pieces.test.ts -t 'own an image asset'`
Expected: FAIL — the asset has no `pieceId` field.

- [ ] **Step 3: Add the ownership field**

In `creativeStudioTypes.ts`, on the asset record beside `projectReferenceId`:

```ts
/** Set when the asset belongs to a Piece. Mutually exclusive with shotId and projectReferenceId. */
pieceId: string | null;
```

Add `'pieceId'` to the asset validator's required key set.

- [ ] **Step 4: Widen the ownership branch**

In `validation.ts`, replace the branch at 753-781 with:

```ts
if (value.shotId === null && value.pieceId !== null) {
  // A Piece owns images only in Pilot 1.
  if (
    !isSafeId(value.pieceId) ||
    value.projectReferenceId !== null ||
    value.mediaKind !== 'image' ||
    !isStudioReferenceImageMimeType(value.mimeType) ||
    (value.managedAsset.collection !== 'assets' && value.managedAsset.collection !== 'imports')
  ) {
    return false;
  }
  if (
    value.managedAsset.collection === 'imports' &&
    (value.producerJobId !== null || value.compositionDigest !== null || value.generationReferenceAssetIds.length !== 0)
  ) {
    return false;
  }
} else if (value.shotId === null && value.mediaKind === 'image') {
  if (
    !isSafeId(value.projectReferenceId) ||
    !isStudioReferenceImageMimeType(value.mimeType) ||
    (value.managedAsset.collection !== 'assets' && value.managedAsset.collection !== 'imports')
  ) {
    return false;
  }
  if (
    value.managedAsset.collection === 'imports' &&
    (value.producerJobId !== null || value.compositionDigest !== null || value.generationReferenceAssetIds.length !== 0)
  ) {
    return false;
  }
} else if (value.shotId === null && value.mediaKind === 'audio') {
  if (!isCanonicalStudioBedAudioAssetV2(value as StudioAssetV2)) return false;
} else if (value.shotId === null || value.mediaKind === 'audio') {
  return false;
}
```

And replace the closing XOR (line 781) with a three-way exclusivity:

```ts
const owners = [value.shotId, value.projectReferenceId, value.pieceId].filter((one) => one !== null);
return owners.length === 1;
```

- [ ] **Step 5: Run the tests**

Run: `bunx vitest run tests/unit/process/creative-studio/service/pieces.test.ts`
Expected: PASS.

- [ ] **Step 6: Run everything that touches assets**

Run: `bunx vitest run tests/unit/process/creative-studio/`
Expected: PASS. Every existing asset fixture needs `pieceId: null` added — that is the exact-key set
doing its job, not a problem to route around.

- [ ] **Step 7: Commit**

```bash
bunx tsc --noEmit && bun run format
git add packages/desktop/src tests/unit/process/creative-studio
git commit -m "feat(studio): let a Piece own an image asset"
```

---

## Task 5: A Piece is an active job owner

**Files:**

- Modify: `.../creative-studio/jobManager.ts:403-419` (`activeOwnerForJobV2`)
- Test: `tests/unit/process/creative-studio/service/pieces.test.ts`

`activeOwnerForJobV2` gates dispatch, gates preparation, and is re-checked inside the output-commit
transaction. All three must accept a Piece or a paid job will be minted and then refused.

- [ ] **Step 1: Write the failing test**

```ts
describe('a Piece is an active job owner', () => {
  it('resolves a piece owner when the piece lists the job', () => {
    const project = projectWithOnePiece();
    const job = pieceJob(project, { purpose: 'seed_still' });
    const withJob = {
      ...project,
      jobs: { [job.id]: job },
      pieces: { ...project.pieces, piece_a: { ...project.pieces.piece_a!, jobIds: [job.id] } },
    };
    expect(activeOwnerForJobV2(withJob, job)).not.toBeNull();
  });

  it('refuses when the piece does not list the job', () => {
    // Symmetry with shots and references: ownership is two-way, so an orphaned job cannot dispatch.
    const project = projectWithOnePiece();
    const job = pieceJob(project, { purpose: 'seed_still' });
    expect(activeOwnerForJobV2({ ...project, jobs: { [job.id]: job } }, job)).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `bunx vitest run tests/unit/process/creative-studio/service/pieces.test.ts -t 'active job owner'`
Expected: FAIL — returns null for a piece target.

- [ ] **Step 3: Add the branch**

In `jobManager.ts`, inside `activeOwnerForJobV2`, before the reference branch:

```ts
if (job.target.kind === 'piece') {
  const piece = ownValueV2(project.pieces, job.target.pieceId);
  return piece !== undefined && piece.jobIds.includes(job.id) ? piece : null;
}
```

Widen the function's return type to include `StudioPieceV2`.

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run tests/unit/process/creative-studio/service/pieces.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bunx tsc --noEmit && bun run format
git add packages/desktop/src tests/unit/process/creative-studio
git commit -m "feat(studio): resolve a Piece as an active job owner"
```

---

## Task 6: Create, rename and delete a Piece — and version the batch contract

**Files:**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts:117` (version) and the
  mutation-kind union
- Modify: `.../creative-studio/service/schema2/mutations/index.ts`
- Test: `tests/unit/process/creative-studio/service/pieces.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('piece mutations', () => {
  it('creates a piece with a derived handle and appends it to the order', () => {
    const project = emptyProject();
    const next = applyOps(project, [
      { kind: 'create_piece', pieceId: 'piece_a', kindOfPiece: 'photograph', fromWords: 'A salt flat at dawn' },
    ]);
    expect(next.pieces.piece_a!.handle).toBe('a_salt_flat_at_dawn');
    expect(next.pieces.piece_a!.handleIsDerived).toBe(true);
    expect(next.pieceOrder).toEqual(['piece_a']);
  });

  it('renaming adopts the handle and keeps the old one as an alias', () => {
    // The wireframe promises the old handle stays valid. Losing it would break a reference the
    // person or the Director may already have used in conversation.
    const project = applyOps(emptyProject(), [
      { kind: 'create_piece', pieceId: 'piece_a', kindOfPiece: 'photograph', fromWords: 'stills two' },
    ]);
    const next = applyOps(project, [{ kind: 'rename_piece', pieceId: 'piece_a', handle: 'noon_closeup' }]);
    expect(next.pieces.piece_a!.handle).toBe('noon_closeup');
    expect(next.pieces.piece_a!.handleIsDerived).toBe(false);
    expect(next.pieces.piece_a!.priorHandles).toEqual(['stills_two']);
  });

  it('refuses a rename that collides with another piece', () => {
    const project = applyOps(emptyProject(), [
      { kind: 'create_piece', pieceId: 'piece_a', kindOfPiece: 'photograph', fromWords: 'one' },
      { kind: 'create_piece', pieceId: 'piece_b', kindOfPiece: 'photograph', fromWords: 'two' },
    ]);
    expect(() => applyOps(project, [{ kind: 'rename_piece', pieceId: 'piece_b', handle: 'one' }])).toThrow();
  });

  it('refuses to delete a piece with a job still running', () => {
    // Deleting an owner mid-flight would strand a paid job with nowhere to land.
    const project = projectWithRunningPieceJob();
    expect(() => applyOps(project, [{ kind: 'delete_piece', pieceId: 'piece_a' }])).toThrow();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `bunx vitest run tests/unit/process/creative-studio/service/pieces.test.ts -t 'piece mutations'`
Expected: FAIL — unknown mutation kind.

- [ ] **Step 3: Bump the batch version**

`creativeStudioTypes.ts:117`:

```ts
export const STUDIO_MUTATION_BATCH_SCHEMA_VERSION = 6 as const;
```

This is a wire and sidecar contract, not the persisted project schema. **Do not touch
`STUDIO_PROJECT_SCHEMA_VERSION`, which stays at 5.**

- [ ] **Step 4: Add the three operations to the union and the disposition table**

```ts
  | { kind: 'create_piece'; pieceId: string; kindOfPiece: StudioPieceKindV2; fromWords: string }
  | { kind: 'rename_piece'; pieceId: string; handle: string }
  | { kind: 'delete_piece'; pieceId: string }
```

In `STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2`, add:

```ts
  create_piece: 'proposal',
  rename_piece: 'direct',
  delete_piece: 'proposal',
```

Renaming is `direct` because it is free and reversible and the spend ruling says not to ask. Creating
and deleting are `proposal` because one commits to work and the other destroys it.

- [ ] **Step 5: Implement the reducers**

In `mutations/index.ts`, beside the reference reducers:

```ts
    case 'create_piece': {
      if (ownValue(draft.pieces, operation.pieceId) !== undefined) return fail('invalid_operation');
      const handle = uniquePieceHandle(draft, derivedPieceHandle(operation.fromWords));
      draft.pieces[operation.pieceId] = {
        id: operation.pieceId,
        handle,
        handleIsDerived: true,
        priorHandles: [],
        kind: operation.kindOfPiece,
        currentAssetId: null,
        supersededAssetIds: [],
        jobIds: [],
        createdAt: now,
        updatedAt: now,
      };
      draft.pieceOrder.push(operation.pieceId);
      return;
    }
    case 'rename_piece': {
      const piece = ownValue(draft.pieces, operation.pieceId);
      if (piece === undefined) return fail('invalid_operation');
      const handle = operation.handle;
      if (!PIECE_HANDLE_PATTERN.test(handle) || handle.length > 48) return fail('invalid_operation');
      if (Object.values(draft.pieces).some((one) => one.id !== piece.id && one.handle === handle)) {
        return fail('invalid_operation');
      }
      if (piece.handle !== handle) piece.priorHandles = [...piece.priorHandles, piece.handle];
      piece.handle = handle;
      piece.handleIsDerived = false;
      piece.updatedAt = now;
      return;
    }
    case 'delete_piece': {
      const piece = ownValue(draft.pieces, operation.pieceId);
      if (piece === undefined) return fail('invalid_operation');
      const live = piece.jobIds
        .map((id) => ownValue(draft.jobs, id))
        .filter((job) => job !== undefined && job.status !== 'succeeded' && job.status !== 'failed' && job.status !== 'cancelled');
      if (live.length > 0) return fail('invalid_operation');
      delete draft.pieces[operation.pieceId];
      draft.pieceOrder = draft.pieceOrder.filter((id) => id !== operation.pieceId);
      return;
    }
```

Add the helper beside them:

```ts
/** A handle is a reference, so it must be unique. Collisions get a numeric suffix, not a rejection. */
const uniquePieceHandle = (draft: StudioProjectV2, wanted: string): string => {
  const taken = new Set(Object.values(draft.pieces).map((piece) => piece.handle));
  if (!taken.has(wanted)) return wanted;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${wanted}_${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${wanted}_${Object.keys(draft.pieces).length + 1}`;
};
```

- [ ] **Step 6: Run the tests**

Run: `bunx vitest run tests/unit/process/creative-studio/service/pieces.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
bunx tsc --noEmit && bun run format
git add packages/desktop/src tests/unit/process/creative-studio
git commit -m "feat(studio): create, rename and delete a Piece"
```

---

## Phase 1 completion gate

Run in this order, from the worktree root. Do not skip 7 or 8 — both are unguarded and both have bitten
this repository.

- [ ] `bun run i18n:types` — regenerates the untracked `i18n-keys.d.ts`
- [ ] `bunx tsc --noEmit`
- [ ] `bun run lint -- --quiet` — errors only; ~1,300 pre-existing warnings are not failures
- [ ] `bun run format` — **oxfmt, never prettier**
- [ ] `node scripts/check-i18n.js`
- [ ] `bunx vitest run tests/unit/process/creative-studio/` — the focused suite
- [ ] **Append every new or changed runtime file to `creativeStudioRuntimeManifest`** in
      `vitest.creative-studio-coverage.config.ts` (116 paths today, per-file 80% lines and branches).
      Nothing enforces this; a missed file is silently uncovered.
- [ ] **No locale keys should have been added by this phase.** If any were, they must land in all
      twelve locales in the same change — `studioI18n.test.ts` asserts exact key sets in both
      directions.
- [ ] `just push` — the full gate

**Definition of done:** a project can hold a standalone photograph Piece; a job can target it; an
asset can be owned by it; the mutation contract can create, rename and delete it; and
`STUDIO_PROJECT_SCHEMA_VERSION` is still 5.

**Explicitly not done in phase 1:** no generation actually runs, no UI exists, the Director cannot
invoke any of this, and nothing is exported. Those are phases 3–5.

---

## Open questions this plan does not settle

Three came from the designer and all concern films, so none blocks phase 1:

1. Whether canvas order is fixed by dependency or reorderable by hand.
2. Whether a second proposal can exist while one is pending. Drawn as: no — the Director waits.
3. Whether `#final_video` auto-recuts when a clip is re-made.

One came from reconciling the wireframe with the store, and it is owed before phase 5:

4. **The corner budget readout cannot be built as drawn.** Every plate shows `$34.90 / $40.00`, but
   `StudioSpendPolicy` holds only `currency` and `maxPerBatchMinorUnits` — a per-batch ceiling. There
   is no authorized total, no committed figure and no remaining balance. A drawn-down envelope is a
   ledger in currency rather than credits, which the 2026-08-30 ruling declined. Pilot 1 therefore
   ships no readout.
