/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';

import {
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  type StudioMutationOperationV2,
  type StudioProjectV2,
  type StudioProposalRecordV2,
} from '@/common/types/project/creativeStudioTypes';
import { createEmptyStudioProjectV2 } from '@/process/services/creative-studio/service/schema2/factories';
import { applyStudioMutationBatchV2 } from '@/process/services/creative-studio/service/schema2/mutations';
import {
  deriveStudioProposalReviewV2,
  studioProposalOperationsV2,
  studioProposalRuleIdV2,
} from '@/process/services/creative-studio/service/schema2/mutations/proposalReview';

const createdAt = '2026-08-24T00:00:00.000Z';

const createProject = (): StudioProjectV2 => {
  const empty = createEmptyStudioProjectV2(
    {
      name: 'Night market film',
      brief: 'Ming and Mei meet at a dai pai dong.',
      aspectRatio: '16:9',
      targetDurationSeconds: 30,
      resolution: '1080p',
    },
    'project_1',
    createdAt
  );
  const applied = applyStudioMutationBatchV2(
    empty,
    {
      schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
      projectId: empty.id,
      expectedRevision: empty.revision,
      operations: [
        {
          kind: 'add_beat',
          beatId: 'beat_arrival',
          beat: { title: 'Arrival', story: 'Ming arrives beneath the red awning.', targetSeconds: 12 },
          beforeBeatId: null,
        },
        {
          kind: 'add_shot',
          beatId: 'beat_arrival',
          shotId: 'shot_ming',
          shot: { shootingScript: 'Wide shot. Ming crosses the wet street.', durationSeconds: 5 },
          beforeShotId: null,
        },
        {
          kind: 'add_shot',
          beatId: 'beat_arrival',
          shotId: 'shot_mei',
          shot: { shootingScript: 'Medium shot. Mei looks up from the counter.', durationSeconds: 5 },
          beforeShotId: null,
        },
      ],
    },
    { mutationId: 'setup', capturedAt: createdAt }
  ).project;
  return { ...applied, revision: empty.revision + 1, updatedAt: createdAt };
};

const proposal = (
  project: StudioProjectV2,
  operations: StudioMutationOperationV2[],
  overrides: Partial<StudioProposalRecordV2> = {}
): StudioProposalRecordV2 => ({
  schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  id: 'proposal_1',
  projectId: project.id,
  status: 'pending',
  baseRevision: project.revision,
  payload: { kind: 'mutation_batch', operations },
  createdAt,
  decidedAt: null,
  ...overrides,
});

describe('schema-5 semantic proposal review', () => {
  it('derives exact Brief, Story, and Shooting script before/after values from the shared reducer', () => {
    const project = createProject();
    const review = deriveStudioProposalReviewV2(
      project,
      proposal(project, [
        { kind: 'set_brief', brief: 'Ming and Mei reconcile over midnight tea.' },
        {
          kind: 'edit_beat',
          beatId: 'beat_arrival',
          changes: { story: 'Mei spots Ming beneath the red awning.' },
        },
        {
          kind: 'edit_shot',
          shotId: 'shot_ming',
          changes: { shootingScript: 'Tracking wide. Ming crosses the rain-slick street.' },
        },
      ])
    );

    expect(review.status).toBe('ready');
    if (review.status !== 'ready') return;
    expect(review.groups).toEqual([
      expect.objectContaining({
        subject: expect.objectContaining({ kind: 'project', id: 'project_1' }),
        fields: [
          {
            key: 'brief',
            before: { kind: 'text', value: 'Ming and Mei meet at a dai pai dong.' },
            after: { kind: 'text', value: 'Ming and Mei reconcile over midnight tea.' },
          },
        ],
      }),
      expect.objectContaining({
        subject: expect.objectContaining({ kind: 'beat', id: 'beat_arrival', title: 'Arrival' }),
        fields: [
          {
            key: 'story',
            before: { kind: 'text', value: 'Ming arrives beneath the red awning.' },
            after: { kind: 'text', value: 'Mei spots Ming beneath the red awning.' },
          },
        ],
      }),
      expect.objectContaining({
        subject: expect.objectContaining({ kind: 'shot', id: 'shot_ming', ownerBeatId: 'beat_arrival' }),
        fields: [
          {
            key: 'shootingScript',
            before: { kind: 'text', value: 'Wide shot. Ming crosses the wet street.' },
            after: { kind: 'text', value: 'Tracking wide. Ming crosses the rain-slick street.' },
          },
        ],
      }),
    ]);
  });

  it('collapses add-then-edit operations into the final intelligible Beat and Shot rows', () => {
    const project = createProject();
    const review = deriveStudioProposalReviewV2(
      project,
      proposal(project, [
        {
          kind: 'add_beat',
          beatId: 'beat_supper',
          beat: { title: 'Supper', story: 'The friends sit down.', targetSeconds: 8 },
          beforeBeatId: null,
        },
        {
          kind: 'edit_beat',
          beatId: 'beat_supper',
          changes: { title: 'Midnight supper', story: 'Ming and Mei share noodles.' },
        },
        {
          kind: 'add_shot',
          beatId: 'beat_supper',
          shotId: 'shot_supper',
          shot: { shootingScript: 'Two-shot at the counter.', durationSeconds: 5 },
          beforeShotId: null,
        },
        {
          kind: 'edit_shot',
          shotId: 'shot_supper',
          changes: { shootingScript: 'Slow push-in on the two friends at the counter.' },
        },
      ])
    );

    expect(review.status).toBe('ready');
    if (review.status !== 'ready') return;
    expect(review.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          change: 'added',
          subject: expect.objectContaining({ kind: 'beat', id: 'beat_supper', title: 'Midnight supper' }),
          fields: expect.arrayContaining([
            { key: 'story', before: null, after: { kind: 'text', value: 'Ming and Mei share noodles.' } },
          ]),
        }),
        expect.objectContaining({
          change: 'added',
          subject: expect.objectContaining({ kind: 'shot', id: 'shot_supper', ownerBeatId: 'beat_supper' }),
          fields: expect.arrayContaining([
            {
              key: 'shootingScript',
              before: null,
              after: { kind: 'text', value: 'Slow push-in on the two friends at the counter.' },
            },
          ]),
        }),
      ])
    );
  });

  it('shows coverage as removed, edited, and added Shot rows under the affected Beat', () => {
    const project = createProject();
    project.shots.shot_ming!.shootingScript = '';
    project.shots.shot_mei!.shootingScript = '';
    const review = deriveStudioProposalReviewV2(
      project,
      proposal(project, [
        {
          kind: 'apply_coverage',
          beatId: 'beat_arrival',
          shots: [
            {
              shotId: 'shot_ming',
              shootingScript: 'Close tracking shot of Ming arriving.',
              durationSeconds: 6,
              chainBreak: 'none',
            },
            {
              shotId: 'shot_table',
              shootingScript: 'Insert: two bowls land on the counter.',
              durationSeconds: 4,
              chainBreak: 'none',
            },
          ],
          fixedShots: [],
        },
      ])
    );

    expect(review.status).toBe('ready');
    if (review.status !== 'ready') return;
    expect(review.groups.map((group) => [group.subject.id, group.change])).toEqual(
      expect.arrayContaining([
        ['shot_ming', 'edited'],
        ['shot_mei', 'removed'],
        ['shot_table', 'added'],
      ])
    );
  });

  it('uses human field labels for metadata and explicit placement rows for reorder and removal', () => {
    const project = createProject();
    project.shots.shot_ming!.shootingScript = '';
    const review = deriveStudioProposalReviewV2(
      project,
      proposal(project, [
        { kind: 'edit_project', changes: { boardStyle: 'line_art', targetDurationSeconds: 42 } },
        { kind: 'reorder_shots', beatId: 'beat_arrival', shotOrder: ['shot_mei', 'shot_ming'] },
        { kind: 'delete_shot', shotId: 'shot_ming' },
      ])
    );

    expect(review.status).toBe('ready');
    if (review.status !== 'ready') return;
    const fieldKeys = review.groups.flatMap((group) => group.fields.map((entry) => entry.key));
    expect(fieldKeys).toEqual(expect.arrayContaining(['boardStyle', 'targetDurationSeconds', 'placement', 'order']));
    expect(JSON.stringify(review)).not.toMatch(/edit_project|reorder_shots|delete_shot/);
  });

  it('includes enforced forbidden terms in a pinned-rule review', () => {
    const project = createProject();
    const record: StudioProposalRecordV2 = {
      ...proposal(project, []),
      id: 'proposal_rule',
      payload: {
        kind: 'pin_rule',
        rule: { text: 'Keep brands fictional.', predicate: { kind: 'forbidden_terms', terms: ['Acme', 'Globex'] } },
      },
    };

    expect(studioProposalOperationsV2(project, record)).toEqual([
      {
        kind: 'set_rules',
        rules: [
          {
            id: studioProposalRuleIdV2(record.id),
            text: 'Keep brands fictional.',
            predicate: { kind: 'forbidden_terms', terms: ['Acme', 'Globex'] },
          },
        ],
      },
    ]);
    const review = deriveStudioProposalReviewV2(project, record);
    expect(review).toMatchObject({
      status: 'ready',
      groups: [
        {
          fields: [
            {
              key: 'rules',
              before: { kind: 'rule_list', values: [] },
              after: {
                kind: 'rule_list',
                values: [{ text: 'Keep brands fictional.', forbiddenTerms: ['Acme', 'Globex'] }],
              },
            },
          ],
        },
      ],
    });
  });

  it('preserves existing plain rules, supports a plain pinned rule, and rejects identity reuse', () => {
    const base = createProject();
    const seeded = applyStudioMutationBatchV2(
      base,
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: base.id,
        expectedRevision: base.revision,
        operations: [
          {
            kind: 'set_rules',
            rules: [{ id: 'rule_existing', text: 'Keep the rain visible.', predicate: null }],
          },
        ],
      },
      { mutationId: 'seed_plain_rule', capturedAt: createdAt }
    ).project;
    const project = { ...seeded, revision: base.revision + 1, updatedAt: createdAt };
    const record: StudioProposalRecordV2 = {
      ...proposal(project, []),
      id: 'proposal_plain_rule',
      payload: { kind: 'pin_rule', rule: { text: 'Keep props period-correct.', predicate: null } },
    };

    expect(studioProposalOperationsV2(project, record)[0]).toMatchObject({
      kind: 'set_rules',
      rules: [
        { id: 'rule_existing', text: 'Keep the rain visible.', predicate: null },
        { id: studioProposalRuleIdV2(record.id), text: 'Keep props period-correct.', predicate: null },
      ],
    });
    expect(deriveStudioProposalReviewV2(project, record)).toMatchObject({
      status: 'ready',
      groups: [
        {
          fields: [
            {
              key: 'rules',
              before: {
                kind: 'rule_list',
                values: [{ text: 'Keep the rain visible.', forbiddenTerms: [] }],
              },
            },
          ],
        },
      ],
    });

    project.rules.push({
      id: studioProposalRuleIdV2(record.id),
      text: 'Collision',
      predicate: null,
    });
    expect(() => studioProposalOperationsV2(project, record)).toThrowError('identity_collision');
  });

  it('reports Beats and Shots parked in the Bin as semantic placement changes', () => {
    const project = createProject();
    const beatReview = deriveStudioProposalReviewV2(
      project,
      proposal(project, [{ kind: 'park_beat', beatId: 'beat_arrival' }])
    );
    expect(beatReview.status).toBe('ready');
    if (beatReview.status !== 'ready') return;
    expect(beatReview.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ change: 'reordered', subject: expect.objectContaining({ kind: 'project' }) }),
        expect.objectContaining({
          change: 'reordered',
          subject: expect.objectContaining({ kind: 'beat', id: 'beat_arrival', position: 1 }),
          fields: [
            expect.objectContaining({
              key: 'placement',
              after: expect.objectContaining({ kind: 'placement', value: 'bin', position: 1 }),
            }),
          ],
        }),
      ])
    );

    const shotReview = deriveStudioProposalReviewV2(
      project,
      proposal(project, [{ kind: 'park_shot', shotId: 'shot_ming' }])
    );
    expect(shotReview).toMatchObject({
      status: 'ready',
      groups: expect.arrayContaining([
        expect.objectContaining({
          change: 'reordered',
          subject: expect.objectContaining({ kind: 'shot', id: 'shot_ming', ownerBeatId: 'beat_arrival' }),
          fields: [
            expect.objectContaining({
              key: 'placement',
              after: expect.objectContaining({ kind: 'placement', value: 'bin', position: 1 }),
            }),
          ],
        }),
      ]),
    });
  });

  it('rejects proposal-only undo operations before reducer replay', () => {
    const project = createProject();
    const record = proposal(project, [{ kind: 'undo_last', entryId: 'undo_1' }]);
    expect(() => studioProposalOperationsV2(project, record)).toThrowError('invalid_operation');
    expect(deriveStudioProposalReviewV2(project, record)).toEqual({
      status: 'unavailable',
      groups: [],
      reason: 'reducer_rejected',
    });
  });

  it('marks a proposal stale without attempting a reducer replay', () => {
    const project = createProject();
    expect(
      deriveStudioProposalReviewV2(
        project,
        proposal(project, [{ kind: 'set_brief', brief: 'Stale edit' }], { baseRevision: project.revision - 1 })
      )
    ).toEqual({
      status: 'stale',
      groups: [],
      currentRevision: project.revision,
      baseRevision: project.revision - 1,
    });
  });

  it('fails closed when the exact reducer rejects the proposal', () => {
    const project = createProject();
    expect(
      deriveStudioProposalReviewV2(project, proposal(project, [{ kind: 'delete_shot', shotId: 'missing_shot' }]))
    ).toEqual({ status: 'unavailable', groups: [], reason: 'reducer_rejected' });
  });
});
