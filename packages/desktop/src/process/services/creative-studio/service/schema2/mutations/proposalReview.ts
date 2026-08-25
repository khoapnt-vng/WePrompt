/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';

import {
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  type StudioBeat,
  type StudioBriefRule,
  type StudioMutationOperationV2,
  type StudioProjectV2,
  type StudioProposalReviewFieldKeyV2,
  type StudioProposalReviewFieldV2,
  type StudioProposalReviewGroupV2,
  type StudioProposalReviewSubjectV2,
  type StudioProposalReviewV2,
  type StudioProposalReviewValueV2,
  type StudioProposalV2,
  type StudioShot,
} from '@/common/types/project/creativeStudioTypes';

import { applyStudioMutationBatchV2, StudioMutationErrorV2 } from './index';

const own = <Value>(record: Record<string, Value>, id: string): Value | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const text = (value: string | null): StudioProposalReviewValueV2 => ({ kind: 'text', value });
const number = (value: number | null): StudioProposalReviewValueV2 => ({ kind: 'number', value });
const textList = (values: readonly string[]): StudioProposalReviewValueV2 => ({
  kind: 'text_list',
  values: [...values],
});
const ruleList = (rules: readonly StudioBriefRule[]): StudioProposalReviewValueV2 => ({
  kind: 'rule_list',
  values: rules.map((rule) => ({
    text: rule.text,
    forbiddenTerms: rule.predicate === null ? [] : [...rule.predicate.terms],
  })),
});

const field = (
  key: StudioProposalReviewFieldKeyV2,
  before: StudioProposalReviewValueV2 | null,
  after: StudioProposalReviewValueV2 | null
): StudioProposalReviewFieldV2 | null => (same(before, after) ? null : { key, before, after });

const compactFields = (fields: readonly (StudioProposalReviewFieldV2 | null)[]): StudioProposalReviewFieldV2[] =>
  fields.filter((value): value is StudioProposalReviewFieldV2 => value !== null);

type Placement = Extract<StudioProposalReviewValueV2, { kind: 'placement' }>;

const beatPlacement = (project: StudioProjectV2, beatId: string): Placement => {
  const activePosition = project.beatOrder.indexOf(beatId);
  if (activePosition >= 0) {
    return {
      kind: 'placement',
      value: 'active',
      position: activePosition + 1,
      ownerBeatId: null,
      ownerBeatTitle: null,
    };
  }
  const binPosition = project.bin.findIndex((item) => item.kind === 'beat' && item.beatId === beatId);
  return {
    kind: 'placement',
    value: binPosition >= 0 ? 'bin' : 'removed',
    position: binPosition >= 0 ? binPosition + 1 : null,
    ownerBeatId: null,
    ownerBeatTitle: null,
  };
};

const shotPlacement = (project: StudioProjectV2, shotId: string): Placement => {
  for (const beatId of project.beatOrder) {
    const beat = own(project.beats, beatId);
    const position = beat?.shotOrder.indexOf(shotId) ?? -1;
    if (beat !== undefined && position >= 0) {
      return {
        kind: 'placement',
        value: 'active',
        position: position + 1,
        ownerBeatId: beat.id,
        ownerBeatTitle: beat.title,
      };
    }
  }
  const binPosition = project.bin.findIndex((item) => item.kind === 'shot' && item.shotId === shotId);
  if (binPosition >= 0) {
    const item = project.bin[binPosition];
    const ownerBeat = item?.kind === 'shot' ? own(project.beats, item.beatId) : undefined;
    return {
      kind: 'placement',
      value: 'bin',
      position: binPosition + 1,
      ownerBeatId: ownerBeat?.id ?? null,
      ownerBeatTitle: ownerBeat?.title ?? null,
    };
  }
  return {
    kind: 'placement',
    value: 'removed',
    position: null,
    ownerBeatId: null,
    ownerBeatTitle: null,
  };
};

const subject = (
  kind: StudioProposalReviewSubjectV2['kind'],
  id: string,
  title: string | null,
  placement: Placement | null
): StudioProposalReviewSubjectV2 => ({
  kind,
  id,
  title,
  position: placement?.position ?? null,
  ownerBeatId: placement?.ownerBeatId ?? null,
  ownerBeatTitle: placement?.ownerBeatTitle ?? null,
});

const orderedBeatIds = (before: StudioProjectV2, after: StudioProjectV2): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  const append = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    result.push(id);
  };
  before.beatOrder.forEach(append);
  before.bin.forEach((item) => item.kind === 'beat' && append(item.beatId));
  Object.keys(before.beats).toSorted().forEach(append);
  after.beatOrder.forEach(append);
  after.bin.forEach((item) => item.kind === 'beat' && append(item.beatId));
  Object.keys(after.beats).toSorted().forEach(append);
  return result;
};

const orderedShotIds = (before: StudioProjectV2, after: StudioProjectV2): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  const append = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    result.push(id);
  };
  const appendProject = (project: StudioProjectV2): void => {
    project.beatOrder.forEach((beatId) => own(project.beats, beatId)?.shotOrder.forEach(append));
    project.bin.forEach((item) => item.kind === 'shot' && append(item.shotId));
    Object.keys(project.shots).toSorted().forEach(append);
  };
  appendProject(before);
  appendProject(after);
  return result;
};

const entityChange = (
  existedBefore: boolean,
  existsAfter: boolean,
  fields: readonly StudioProposalReviewFieldV2[]
): StudioProposalReviewGroupV2['change'] => {
  if (!existedBefore) return 'added';
  if (!existsAfter) return 'removed';
  return fields.length === 1 && fields[0]?.key === 'placement' ? 'reordered' : 'edited';
};

const beatFields = (
  beforeProject: StudioProjectV2,
  afterProject: StudioProjectV2,
  before: StudioBeat | undefined,
  after: StudioBeat,
  beatId: string
): StudioProposalReviewFieldV2[] =>
  compactFields([
    field('title', before === undefined ? null : text(before.title), text(after.title)),
    field('story', before === undefined ? null : text(before.story), text(after.story)),
    field('targetSeconds', before === undefined ? null : number(before.targetSeconds), number(after.targetSeconds)),
    field(
      'placement',
      before === undefined ? null : beatPlacement(beforeProject, beatId),
      beatPlacement(afterProject, beatId)
    ),
    field('order', before === undefined ? null : textList(before.shotOrder), textList(after.shotOrder)),
  ]);

const shotFields = (
  beforeProject: StudioProjectV2,
  afterProject: StudioProjectV2,
  before: StudioShot | undefined,
  after: StudioShot | undefined,
  shotId: string
): StudioProposalReviewFieldV2[] =>
  compactFields([
    field(
      'shootingScript',
      before === undefined ? null : text(before.shootingScript),
      after === undefined ? null : text(after.shootingScript)
    ),
    field(
      'durationSeconds',
      before === undefined ? null : number(before.durationSeconds),
      after === undefined ? null : number(after.durationSeconds)
    ),
    field(
      'chainBreak',
      before === undefined ? null : text(before.chainBreak),
      after === undefined ? null : text(after.chainBreak)
    ),
    field(
      'placement',
      before === undefined ? null : shotPlacement(beforeProject, shotId),
      after === undefined ? null : shotPlacement(afterProject, shotId)
    ),
  ]);

const projectGroup = (before: StudioProjectV2, after: StudioProjectV2): StudioProposalReviewGroupV2 | null => {
  const fields = compactFields([
    field('name', text(before.name), text(after.name)),
    field('brief', text(before.brief), text(after.brief)),
    field('rules', ruleList(before.rules), ruleList(after.rules)),
    field('aspectRatio', text(before.aspectRatio), text(after.aspectRatio)),
    field('resolution', text(before.resolution), text(after.resolution)),
    field('targetDurationSeconds', number(before.targetDurationSeconds), number(after.targetDurationSeconds)),
    field('boardStyle', text(before.boardStyle), text(after.boardStyle)),
    field('order', textList(before.beatOrder), textList(after.beatOrder)),
  ]);
  return fields.length === 0
    ? null
    : {
        change: fields.length === 1 && fields[0]?.key === 'order' ? 'reordered' : 'edited',
        subject: subject('project', before.id, before.name, null),
        fields,
      };
};

/** Stable app-owned rule identity used by both review and CAS acceptance. */
export const studioProposalRuleIdV2 = (proposalId: string): string =>
  `rule_${createHash('sha256').update(proposalId, 'utf8').digest('hex').slice(0, 24)}`;

/** Expands every durable proposal into the exact reducer operations acceptance will execute. */
export const studioProposalOperationsV2 = (
  project: StudioProjectV2,
  proposal: Pick<StudioProposalV2, 'id' | 'payload'>
): StudioMutationOperationV2[] => {
  if (proposal.payload.kind === 'mutation_batch') {
    if (proposal.payload.operations.some((operation) => operation.kind === 'undo_last')) {
      throw new StudioMutationErrorV2('invalid_operation');
    }
    return structuredClone(proposal.payload.operations);
  }
  const ruleId = studioProposalRuleIdV2(proposal.id);
  if (project.rules.some((rule) => rule.id === ruleId)) throw new StudioMutationErrorV2('identity_collision');
  return [
    {
      kind: 'set_rules',
      rules: [
        ...project.rules.map((rule) => ({
          id: rule.id,
          text: rule.text,
          predicate:
            rule.predicate === null ? null : { kind: 'forbidden_terms' as const, terms: [...rule.predicate.terms] },
        })),
        {
          id: ruleId,
          text: proposal.payload.rule.text,
          predicate:
            proposal.payload.rule.predicate === null
              ? null
              : { kind: 'forbidden_terms' as const, terms: [...proposal.payload.rule.predicate.terms] },
        },
      ],
    },
  ];
};

/** Derives renderer-safe semantic review from the exact reducer result without persisting a second diff. */
export const deriveStudioProposalReviewV2 = (
  project: StudioProjectV2,
  proposal: Pick<StudioProposalV2, 'id' | 'projectId' | 'baseRevision' | 'payload' | 'createdAt'>
): StudioProposalReviewV2 => {
  if (project.revision !== proposal.baseRevision) {
    return { status: 'stale', groups: [], currentRevision: project.revision, baseRevision: proposal.baseRevision };
  }
  try {
    const operations = studioProposalOperationsV2(project, proposal);
    const after = applyStudioMutationBatchV2(
      project,
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: proposal.projectId,
        expectedRevision: proposal.baseRevision,
        operations,
      },
      { mutationId: proposal.id, capturedAt: proposal.createdAt }
    ).project;
    const groups: StudioProposalReviewGroupV2[] = [];
    const projectChanges = projectGroup(project, after);
    if (projectChanges !== null) groups.push(projectChanges);
    for (const beatId of orderedBeatIds(project, after)) {
      const beforeBeat = own(project.beats, beatId);
      // Current schema-5 operations can add or park Beats, but never erase their records.
      const afterBeat = own(after.beats, beatId)!;
      const fields = beatFields(project, after, beforeBeat, afterBeat, beatId);
      if (fields.length === 0) continue;
      const placement = beatPlacement(after, beatId);
      groups.push({
        change: entityChange(beforeBeat !== undefined, true, fields),
        subject: subject('beat', beatId, afterBeat.title, placement),
        fields,
      });
    }
    for (const shotId of orderedShotIds(project, after)) {
      const beforeShot = own(project.shots, shotId);
      const afterShot = own(after.shots, shotId);
      const fields = shotFields(project, after, beforeShot, afterShot, shotId);
      if (fields.length === 0) continue;
      const placement = afterShot === undefined ? shotPlacement(project, shotId) : shotPlacement(after, shotId);
      groups.push({
        change: entityChange(beforeShot !== undefined, afterShot !== undefined, fields),
        subject: subject('shot', shotId, null, placement),
        fields,
      });
    }
    return { status: 'ready', groups };
  } catch {
    return { status: 'unavailable', groups: [], reason: 'reducer_rejected' };
  }
};
