/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioBeat,
  StudioProjectReferenceV2,
  StudioProjectV2,
  StudioShot,
} from '@/common/types/project/creativeStudioTypes';

/**
 * The part of a project a person authored, separated from the part machines maintain.
 *
 * BUG-028. A pending proposal is fenced on an exact project-revision match, but `jobs` and `assets`
 * live inside the same document and every write bumps the revision, so a job ticking over kills a
 * reviewed, paid draft permanently. The fence has to ask the question it means — "did anything a
 * person authored change?" — and that requires knowing which fields those are.
 *
 * **Getting the split wrong fails in both directions.** Include an operational field and the bug
 * returns intact. Exclude an authored one and a real edit is silently clobbered by an older
 * proposal. So the classification is exhaustive rather than a filter: every key of the project, of
 * a Beat, of a Shot and of a reference must be named in exactly one list, and
 * `authoredProjectDigestInput` throws on any key nobody has classified. A field added later cannot
 * default into either meaning — someone has to decide, which is the whole point.
 */

/** Fields a person set, directly or through the Director acting on their behalf. */
const AUTHORED_PROJECT_KEYS = [
  'name',
  // `brief` is not a field on the wire: the text lives in `brief.md` and the project carries only
  // `briefFile`, its `{ schemaVersion, sha256 }` pointer. Both are listed because the type declares
  // `brief` and real records carry `briefFile`, and missing the latter would have let a stale
  // proposal clobber an edited brief — found by digesting real projects rather than a fixture.
  'brief',
  'briefFile',
  'rules',
  'aspectRatio',
  'targetDurationSeconds',
  'resolution',
  'boardStyle',
  'beatOrder',
  'beats',
  'shots',
  'referencePlanStatus',
  'referenceOrder',
  'references',
  'bin',
  'bedAssetId',
  'imageRouteId',
  'videoRouteId',
  'spendPolicy',
] as const;

/**
 * Fields machines maintain, plus identity and clocks. These are exactly what must not fence a
 * proposal: `jobs` and `assets` change on every poll, `revision` and `updatedAt` change on every
 * write of any kind, and identity cannot change at all.
 */
const OPERATIONAL_PROJECT_KEYS = [
  'schemaVersion',
  'revision',
  'id',
  'forgeProjectId',
  'briefConversationId',
  'spendAuthorizations',
  'frameExtractions',
  'undoHistory',
  'assets',
  'jobs',
  'createdAt',
  'updatedAt',
] as const;

/** A Beat is wholly authored: a title, a story, a target length and the order of its Shots. */
const AUTHORED_BEAT_KEYS = ['id', 'title', 'story', 'targetSeconds', 'shotOrder'] as const;
const OPERATIONAL_BEAT_KEYS = [] as const;

/**
 * A Shot is the mixed case, and the one the 2026-08-07 design called the load-bearing line of the
 * whole note. `shootingScript`, timings, the continuity choice, reference bindings and the pinned
 * first frame are decisions; every asset and job id on the Shot is the record of work.
 */
const AUTHORED_SHOT_KEYS = [
  'id',
  'shootingScript',
  'durationSeconds',
  'trimInSeconds',
  'trimOutSeconds',
  'chainBreak',
  'referenceBinding',
  'seedStillId',
  'dismissedSeedStillIds',
] as const;
const OPERATIONAL_SHOT_KEYS = [
  'boardAssetId',
  'supersededBoardAssetIds',
  'videoAssetId',
  'supersededVideoAssetIds',
  'assetIds',
  'jobIds',
] as const;

/** A reference's label, prompt and kind are authored; its images and jobs are produced. */
const AUTHORED_REFERENCE_KEYS = ['id', 'kind', 'label', 'prompt'] as const;
const OPERATIONAL_REFERENCE_KEYS = [
  'approvedAssetId',
  'supersededAssetIds',
  'jobIds',
  'createdAt',
  'updatedAt',
] as const;

export class StudioAuthoredDigestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StudioAuthoredDigestError';
  }
}

const project = (
  value: object,
  authored: readonly string[],
  operational: readonly string[],
  what: string
): Record<string, unknown> => {
  const classified = new Set<string>([...authored, ...operational]);
  const unknown = Object.keys(value).filter((key) => !classified.has(key));
  if (unknown.length > 0) {
    throw new StudioAuthoredDigestError(
      `Unclassified ${what} field(s) for the authored digest: ${unknown.sort().join(', ')}. ` +
        'Decide whether each is authored or operational; it cannot default to either.'
    );
  }
  const result: Record<string, unknown> = {};
  for (const key of authored) {
    if (Object.hasOwn(value, key)) result[key] = (value as Record<string, unknown>)[key];
  }
  return result;
};

const authoredBeat = (beat: StudioBeat): Record<string, unknown> =>
  project(beat, AUTHORED_BEAT_KEYS, OPERATIONAL_BEAT_KEYS, 'Beat');

const authoredShot = (shot: StudioShot): Record<string, unknown> =>
  project(shot, AUTHORED_SHOT_KEYS, OPERATIONAL_SHOT_KEYS, 'Shot');

const authoredReference = (reference: StudioProjectReferenceV2): Record<string, unknown> =>
  project(reference, AUTHORED_REFERENCE_KEYS, OPERATIONAL_REFERENCE_KEYS, 'reference');

const byKey = (
  record: Record<string, unknown>,
  map: (value: never) => Record<string, unknown>
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  // Sorted so the digest cannot depend on insertion order, which no authoring change controls.
  for (const key of Object.keys(record).sort()) result[key] = map(record[key] as never);
  return result;
};

/**
 * The exact value the digest is taken over. Exported so tests can assert what is in it and what is
 * not, rather than inferring the classification from a hash that says nothing when it differs.
 */
export const authoredProjectDigestInput = (value: StudioProjectV2): Record<string, unknown> => {
  const shallow = project(value, AUTHORED_PROJECT_KEYS, OPERATIONAL_PROJECT_KEYS, 'project');
  return {
    ...shallow,
    beats: byKey(value.beats as unknown as Record<string, unknown>, authoredBeat as never),
    shots: byKey(value.shots as unknown as Record<string, unknown>, authoredShot as never),
    references: byKey(value.references as unknown as Record<string, unknown>, authoredReference as never),
  };
};
