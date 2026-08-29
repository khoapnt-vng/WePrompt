/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import type { StudioProjectV2 } from '@/common/types/project/creativeStudioTypes';
import {
  authoredProjectDigestInput,
  StudioAuthoredDigestError,
} from '@process/services/creative-studio/service/schema2/authoredDigest';

/**
 * BUG-028. A pending proposal is fenced on an exact project-revision match while `jobs` and
 * `assets` live in the same document, so a job ticking over kills a reviewed, paid draft
 * permanently. The fence has to ask "did anything a person authored change?", which means the
 * authored/operational split is the whole correctness argument:
 *
 *  - include an operational field and the bug comes back intact;
 *  - exclude an authored one and a stale proposal silently clobbers a real edit.
 *
 * These tests pin the split field by field rather than asserting a hash, because a hash that
 * differs tells you nothing about which side got it wrong.
 */

const shot = (id: string): StudioProjectV2['shots'][string] => ({
  id,
  shootingScript: 'A slow push in.',
  durationSeconds: 6,
  trimInSeconds: null,
  trimOutSeconds: null,
  chainBreak: 'none',
  referenceBinding: { status: 'unassigned', referenceIds: [] },
  seedStillId: null,
  dismissedSeedStillIds: [],
  boardAssetId: null,
  supersededBoardAssetIds: [],
  videoAssetId: null,
  supersededVideoAssetIds: [],
  assetIds: [],
  jobIds: [],
});

const project = (): StudioProjectV2 =>
  ({
    schemaVersion: 5,
    revision: 3,
    id: 'project_1',
    name: 'Launch film',
    briefFile: { schemaVersion: 1, sha256: 'a'.repeat(64) },
    rules: [],
    briefConversationId: 'conversation_1',
    aspectRatio: '16:9',
    targetDurationSeconds: 18,
    resolution: '1080p',
    boardStyle: null,
    beatOrder: ['beat_1'],
    beats: { beat_1: { id: 'beat_1', title: 'Opening', story: 'It begins.', targetSeconds: 6, shotOrder: ['shot_1'] } },
    shots: { shot_1: shot('shot_1') },
    referencePlanStatus: 'unplanned',
    referenceOrder: [],
    references: {},
    bin: [],
    bedAssetId: null,
    spendPolicy: null,
    spendAuthorizations: [],
    frameExtractions: {},
    undoHistory: [],
    imageRouteId: null,
    videoRouteId: null,
    assets: {},
    jobs: {},
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }) as unknown as StudioProjectV2;

describe('authored project digest input', () => {
  it('ignores the machine state that made BUG-028 reachable', () => {
    const before = authoredProjectDigestInput(project());

    const withWork = project();
    withWork.revision = 99;
    withWork.updatedAt = '2026-09-09T00:00:00.000Z';
    withWork.jobs = { job_1: { id: 'job_1' } as never };
    withWork.assets = { asset_1: { id: 'asset_1' } as never };
    withWork.frameExtractions = { extraction_1: {} as never };
    withWork.undoHistory = [{} as never];
    withWork.spendAuthorizations = [{} as never];
    withWork.shots.shot_1!.videoAssetId = 'asset_1';
    withWork.shots.shot_1!.assetIds = ['asset_1'];
    withWork.shots.shot_1!.jobIds = ['job_1'];
    withWork.shots.shot_1!.boardAssetId = 'asset_2';

    expect(authoredProjectDigestInput(withWork)).toEqual(before);
  });

  it.each([
    ['a rewritten shooting script', (value: StudioProjectV2) => (value.shots.shot_1!.shootingScript = 'Different.')],
    ['a retimed Shot', (value: StudioProjectV2) => (value.shots.shot_1!.durationSeconds = 9)],
    ['a cut set free', (value: StudioProjectV2) => (value.shots.shot_1!.chainBreak = 'hard_cut')],
    ['a pinned first frame', (value: StudioProjectV2) => (value.shots.shot_1!.seedStillId = 'asset_seed')],
    ['a retitled Beat', (value: StudioProjectV2) => (value.beats.beat_1!.title = 'Different')],
    ['a reordered Beat', (value: StudioProjectV2) => (value.beatOrder = ['beat_1', 'beat_2'])],
    [
      'an edited brief',
      // Real records carry no `brief` field: the text lives in brief.md and the project holds only
      // this hash. Digesting real projects rather than a fixture is what caught that, and missing
      // it would have let a stale proposal clobber an edited brief.
      (value: StudioProjectV2) => Object.assign(value, { briefFile: { schemaVersion: 1, sha256: 'b'.repeat(64) } }),
    ],
    ['a changed aspect ratio', (value: StudioProjectV2) => (value.aspectRatio = '9:16')],
    ['a chosen route', (value: StudioProjectV2) => (value.imageRouteId = 'route_1')],
    ['a renamed project', (value: StudioProjectV2) => (value.name = 'Different')],
  ])('notices %s', (_label, mutate) => {
    const before = authoredProjectDigestInput(project());
    const after = project();
    mutate(after);
    expect(authoredProjectDigestInput(after)).not.toEqual(before);
  });

  it('does not depend on the order keys happen to be written in', () => {
    const straight = project();
    straight.beats = {
      beat_1: { id: 'beat_1', title: 'Opening', story: 'It begins.', targetSeconds: 6, shotOrder: ['shot_1'] },
      beat_2: { id: 'beat_2', title: 'Close', story: 'It ends.', targetSeconds: 6, shotOrder: [] },
    };
    const reversed = project();
    reversed.beats = {
      beat_2: { id: 'beat_2', title: 'Close', story: 'It ends.', targetSeconds: 6, shotOrder: [] },
      beat_1: { id: 'beat_1', title: 'Opening', story: 'It begins.', targetSeconds: 6, shotOrder: ['shot_1'] },
    };
    straight.beatOrder = ['beat_1', 'beat_2'];
    reversed.beatOrder = ['beat_1', 'beat_2'];

    expect(JSON.stringify(authoredProjectDigestInput(reversed))).toBe(
      JSON.stringify(authoredProjectDigestInput(straight))
    );
  });

  it.each([
    ['project', (value: StudioProjectV2) => Object.assign(value, { somethingNew: 1 })],
    ['Beat', (value: StudioProjectV2) => Object.assign(value.beats.beat_1!, { somethingNew: 1 })],
    ['Shot', (value: StudioProjectV2) => Object.assign(value.shots.shot_1!, { somethingNew: 1 })],
  ])('refuses to guess when a new %s field appears', (what, mutate) => {
    /*
     * The classification is the correctness argument, so a field nobody has classified must stop
     * the digest rather than default into one side. `StudioProjectV2` gains fields regularly; this
     * is what makes the next one a decision instead of an accident.
     */
    const value = project();
    mutate(value);
    expect(() => authoredProjectDigestInput(value)).toThrow(StudioAuthoredDigestError);
    expect(() => authoredProjectDigestInput(value)).toThrow(new RegExp(`Unclassified ${what} field`));
  });
});
