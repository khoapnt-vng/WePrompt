/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioEditableBeat,
  StudioEditableShot,
  StudioFixedShotReasonV2,
  StudioMutationOperationV2,
  StudioProjectReferenceDraftV2,
  StudioProjectReferenceKindV2,
  StudioProposedShot,
  StudioRendererProjectV2,
} from '@/common/types/project/creativeStudioTypes';

export type ProposalReviewEntity = {
  kind: 'beat' | 'shot' | 'reference';
  id: string;
  title: string | null;
  position: number | null;
  ownerBeat: { id: string; title: string | null } | null;
};

export type ProposalReviewValue =
  | { kind: 'text'; value: string | null }
  | { kind: 'number'; value: number | null }
  | { kind: 'entities'; values: ProposalReviewEntity[] }
  | { kind: 'placement'; value: 'bin' | 'end' | { before: ProposalReviewEntity } }
  | { kind: 'referenceKind'; value: StudioProjectReferenceKindV2 | null }
  | { kind: 'chainBreak'; value: StudioProposedShot['chainBreak'] | null };

export type ProposalReviewFieldKey =
  | 'brief'
  | 'title'
  | 'action'
  | 'look'
  | 'targetSeconds'
  | 'placement'
  | 'ownerBeat'
  | 'line'
  | 'narration'
  | 'onScreenText'
  | 'durationSeconds'
  | 'chainBreak'
  | 'identity'
  | 'order'
  | 'referenceKind'
  | 'referencePrompt'
  | 'assignedShots';

export type ProposalReviewField = {
  key: ProposalReviewFieldKey;
  before?: ProposalReviewValue;
  after: ProposalReviewValue;
};

export type ReviewableProposalOperation = Extract<
  StudioMutationOperationV2,
  {
    kind:
      | 'set_brief'
      | 'set_project_references'
      | 'add_beat'
      | 'edit_beat'
      | 'reorder_beats'
      | 'add_binned_beat'
      | 'add_shot'
      | 'edit_shot'
      | 'delete_shot'
      | 'reorder_shots'
      | 'apply_coverage'
      | 'redetach_line'
      | 'rederive_line'
      | 'reorder_bin';
  }
>;

export type ProposalOperationReview =
  | {
      kind: 'fields';
      operationKind: Exclude<ReviewableProposalOperation['kind'], 'apply_coverage' | 'set_project_references'>;
      subject: ProposalReviewEntity | null;
      fields: ProposalReviewField[];
    }
  | {
      kind: 'coverage';
      operationKind: 'apply_coverage';
      beat: ProposalReviewEntity;
      order: ProposalReviewField;
      shots: Array<{
        change: 'added' | 'removed' | 'retained';
        subject: ProposalReviewEntity;
        fields: ProposalReviewField[];
      }>;
      fixedShots: Extract<ReviewableProposalOperation, { kind: 'apply_coverage' }>['fixedShots'];
    }
  | {
      kind: 'references';
      operationKind: 'set_project_references';
      order: ProposalReviewField;
      references: Array<{
        subject: ProposalReviewEntity;
        fields: ProposalReviewField[];
      }>;
    };

type ReviewBeat = StudioEditableBeat & { id: string; shotOrder: string[] };
type ReviewShot = StudioEditableShot & {
  id: string;
  ownerBeatId: string | null;
  chainBreak: StudioProposedShot['chainBreak'];
  referenceIds: string[];
  observableFixedReasons: StudioFixedShotReasonV2[];
};
type ReviewReference = Omit<StudioProjectReferenceDraftV2, 'shotIds'>;

type ReviewState = {
  brief: string;
  beatOrder: string[];
  beats: Map<string, ReviewBeat>;
  shots: Map<string, ReviewShot>;
  knownBeatIds: Set<string>;
  knownShotIds: Set<string>;
  bin: StudioRendererProjectV2['bin'];
  referenceOrder: string[];
  references: Map<string, ReviewReference>;
};

const text = (value: string | null): ProposalReviewValue => ({ kind: 'text', value });
const number = (value: number | null): ProposalReviewValue => ({ kind: 'number', value });
const entities = (values: ProposalReviewEntity[]): ProposalReviewValue => ({ kind: 'entities', values });
const placement = (value: ProposalReviewValue & { kind: 'placement' }): ProposalReviewValue => value;
const chainBreak = (value: StudioProposedShot['chainBreak'] | null): ProposalReviewValue => ({
  kind: 'chainBreak',
  value,
});

const FIXED_REASON_ORDER: readonly StudioFixedShotReasonV2[] = [
  'owned_asset',
  'owned_job',
  'video_asset',
  'seed_still',
  'conditioning_frame',
  'conditioning_input',
  'narration',
  'on_screen_text',
];
const OPAQUE_FIXED_REASONS: ReadonlySet<StudioFixedShotReasonV2> = new Set([
  'conditioning_frame',
  'conditioning_input',
]);

const observableFixedReasons = (
  shot: Pick<
    StudioRendererProjectV2['shots'][string],
    'assetIds' | 'jobIds' | 'videoAssetId' | 'seedStillId' | 'narration' | 'onScreenText'
  >
): StudioFixedShotReasonV2[] => {
  const present = new Set<StudioFixedShotReasonV2>();
  if (shot.assetIds.length > 0) present.add('owned_asset');
  if (shot.jobIds.length > 0) present.add('owned_job');
  if (shot.videoAssetId !== null) present.add('video_asset');
  if (shot.seedStillId !== null) present.add('seed_still');
  if (shot.narration.length > 0) present.add('narration');
  if (shot.onScreenText.length > 0) present.add('on_screen_text');
  return FIXED_REASON_ORDER.filter((reason) => present.has(reason));
};

const updateAuthoredFixedReasons = (
  current: readonly StudioFixedShotReasonV2[],
  shot: Pick<StudioEditableShot, 'narration' | 'onScreenText'>
): StudioFixedShotReasonV2[] => {
  const next = new Set<StudioFixedShotReasonV2>(
    current.filter((reason) => reason !== 'narration' && reason !== 'on_screen_text')
  );
  if (shot.narration.length > 0) next.add('narration');
  if (shot.onScreenText.length > 0) next.add('on_screen_text');
  return FIXED_REASON_ORDER.filter((reason) => next.has(reason));
};

const isReviewableProposalOperation = (
  operation: StudioMutationOperationV2
): operation is ReviewableProposalOperation =>
  operation.kind === 'set_brief' ||
  operation.kind === 'set_project_references' ||
  operation.kind === 'add_beat' ||
  operation.kind === 'edit_beat' ||
  operation.kind === 'reorder_beats' ||
  operation.kind === 'add_binned_beat' ||
  operation.kind === 'add_shot' ||
  operation.kind === 'edit_shot' ||
  operation.kind === 'delete_shot' ||
  operation.kind === 'reorder_shots' ||
  operation.kind === 'apply_coverage' ||
  operation.kind === 'redetach_line' ||
  operation.kind === 'rederive_line' ||
  operation.kind === 'reorder_bin';

const insertBefore = (order: string[], id: string, beforeId: string | null): void => {
  const without = order.filter((candidate) => candidate !== id);
  const index = beforeId === null ? -1 : without.indexOf(beforeId);
  if (index < 0) without.push(id);
  else without.splice(index, 0, id);
  order.splice(0, order.length, ...without);
};

const isExactIdentityOrder = (current: readonly string[], next: readonly string[]): boolean =>
  current.length === next.length && new Set(next).size === next.length && current.every((id) => next.includes(id));

const initialReviewState = (project: StudioRendererProjectV2): ReviewState => {
  const beats = new Map<string, ReviewBeat>();
  const shots = new Map<string, ReviewShot>();
  for (const [beatId, beat] of Object.entries(project.beats)) {
    if (beat.id !== beatId) continue;
    beats.set(beatId, {
      id: beatId,
      title: beat.title,
      action: beat.action,
      look: beat.look,
      targetSeconds: beat.targetSeconds,
      shotOrder: [...beat.shotOrder],
    });
  }
  const owners = new Map<string, string>();
  for (const beat of beats.values()) {
    for (const shotId of beat.shotOrder) owners.set(shotId, beat.id);
  }
  for (const item of project.bin) {
    if (item.kind === 'shot') owners.set(item.shotId, item.beatId);
  }
  for (const [shotId, shot] of Object.entries(project.shots)) {
    if (shot.id !== shotId) continue;
    shots.set(shotId, {
      id: shotId,
      ownerBeatId: owners.get(shotId) ?? null,
      line: shot.line,
      narration: shot.narration,
      onScreenText: shot.onScreenText,
      durationSeconds: shot.durationSeconds,
      chainBreak: shot.chainBreak,
      referenceIds: [...shot.referenceIds],
      observableFixedReasons: observableFixedReasons(shot),
    });
  }
  return {
    brief: project.brief,
    beatOrder: [...project.beatOrder],
    beats,
    shots,
    knownBeatIds: new Set(Object.keys(project.beats)),
    knownShotIds: new Set(Object.keys(project.shots)),
    bin: project.bin.map((item) => ({ ...item })),
    referenceOrder: [...project.referenceOrder],
    references: new Map(
      project.referenceOrder.flatMap((referenceId) => {
        const reference = Object.hasOwn(project.references, referenceId) ? project.references[referenceId] : undefined;
        return reference?.id === referenceId
          ? [
              [
                referenceId,
                { id: reference.id, kind: reference.kind, label: reference.label, prompt: reference.prompt },
              ],
            ]
          : [];
      })
    ),
  };
};

const beatEntity = (state: ReviewState, beatId: string): ProposalReviewEntity => {
  const beat = state.beats.get(beatId);
  const activePosition = state.beatOrder.indexOf(beatId);
  return {
    kind: 'beat',
    id: beatId,
    title: beat?.title || null,
    position: activePosition < 0 ? null : activePosition + 1,
    ownerBeat: null,
  };
};

const shotEntity = (state: ReviewState, shotId: string): ProposalReviewEntity => {
  const shot = state.shots.get(shotId);
  const owner =
    shot?.ownerBeatId === null || shot?.ownerBeatId === undefined ? null : state.beats.get(shot.ownerBeatId);
  const position = owner?.shotOrder.indexOf(shotId) ?? -1;
  return {
    kind: 'shot',
    id: shotId,
    title: null,
    position: position < 0 ? null : position + 1,
    ownerBeat: owner === undefined ? null : { id: owner.id, title: owner.title || null },
  };
};

const referenceEntity = (
  reference: ReviewReference | StudioProjectReferenceDraftV2,
  position: number | null
): ProposalReviewEntity => ({
  kind: 'reference',
  id: reference.id,
  title: reference.label || null,
  position,
  ownerBeat: null,
});

const orderedShotIds = (state: ReviewState): string[] => {
  const ids: string[] = [];
  const seen = new Set<string>();
  const append = (shotId: string): void => {
    if (!seen.has(shotId) && state.shots.has(shotId)) {
      seen.add(shotId);
      ids.push(shotId);
    }
  };
  for (const beatId of state.beatOrder) state.beats.get(beatId)?.shotOrder.forEach(append);
  for (const item of state.bin) {
    if (item.kind === 'shot') append(item.shotId);
    else state.beats.get(item.beatId)?.shotOrder.forEach(append);
  }
  state.shots.forEach((_shot, shotId) => append(shotId));
  return ids;
};

const activeShotIds = (state: ReviewState): string[] =>
  state.beatOrder.flatMap((beatId) => state.beats.get(beatId)?.shotOrder ?? []);

const beforePlacement = (state: ReviewState, beforeId: string | null, kind: 'beat' | 'shot'): ProposalReviewValue =>
  placement({
    kind: 'placement',
    value:
      beforeId === null
        ? 'end'
        : { before: kind === 'beat' ? beatEntity(state, beforeId) : shotEntity(state, beforeId) },
  });

const authoredBeatFields = (beat: StudioEditableBeat): ProposalReviewField[] => [
  { key: 'title', after: text(beat.title) },
  { key: 'action', after: text(beat.action) },
  { key: 'look', after: text(beat.look) },
  { key: 'targetSeconds', after: number(beat.targetSeconds) },
];

const authoredShotFields = (shot: StudioEditableShot): ProposalReviewField[] => [
  { key: 'line', after: text(shot.line) },
  { key: 'narration', after: text(shot.narration) },
  { key: 'onScreenText', after: text(shot.onScreenText) },
  { key: 'durationSeconds', after: number(shot.durationSeconds) },
];

const removedShotFields = (shot: StudioEditableShot): ProposalReviewField[] => [
  { key: 'line', before: text(shot.line), after: text(null) },
  { key: 'narration', before: text(shot.narration), after: text(null) },
  { key: 'onScreenText', before: text(shot.onScreenText), after: text(null) },
  { key: 'durationSeconds', before: number(shot.durationSeconds), after: number(null) },
];

const coverageShotFields = (
  before: ReviewShot | undefined,
  after: StudioProposedShot | undefined,
  beforeEntity: ProposalReviewEntity | undefined,
  afterEntity: ProposalReviewEntity | undefined
): ProposalReviewField[] => {
  const fields: ProposalReviewField[] = [
    {
      key: 'identity',
      before: entities(beforeEntity === undefined ? [] : [beforeEntity]),
      after: entities(afterEntity === undefined ? [] : [afterEntity]),
    },
  ];
  const appendText = (key: 'line' | 'narration' | 'onScreenText'): void => {
    fields.push({
      key,
      ...(before === undefined ? {} : { before: text(before[key]) }),
      after: text(after?.[key] ?? null),
    });
  };
  appendText('line');
  appendText('narration');
  appendText('onScreenText');
  fields.push({
    key: 'durationSeconds',
    ...(before === undefined ? {} : { before: number(before.durationSeconds) }),
    after: number(after?.durationSeconds ?? null),
  });
  fields.push({
    key: 'chainBreak',
    ...(before === undefined ? {} : { before: chainBreak(before.chainBreak) }),
    after: chainBreak(after?.chainBreak ?? null),
  });
  return fields;
};

const reviewReferences = (
  state: ReviewState,
  operation: Extract<ReviewableProposalOperation, { kind: 'set_project_references' }>
): Extract<ProposalOperationReview, { kind: 'references' }> => {
  const proposed = new Map(operation.references.map((reference) => [reference.id, reference]));
  const beforeOrder = entities(
    state.referenceOrder.flatMap((referenceId, index) => {
      const reference = state.references.get(referenceId);
      return reference === undefined ? [] : [referenceEntity(reference, index + 1)];
    })
  );
  const afterOrder = entities(operation.references.map((reference, index) => referenceEntity(reference, index + 1)));
  const orderedIds = [
    ...operation.references.map((reference) => reference.id),
    ...state.referenceOrder.filter((referenceId) => !proposed.has(referenceId)),
  ];
  return {
    kind: 'references',
    operationKind: 'set_project_references',
    order: { key: 'order', before: beforeOrder, after: afterOrder },
    references: orderedIds.flatMap((referenceId, index) => {
      const current = state.references.get(referenceId);
      const next = proposed.get(referenceId);
      if (current === undefined && next === undefined) return [];
      const currentShotIds = orderedShotIds(state).filter((shotId) =>
        state.shots.get(shotId)?.referenceIds.includes(referenceId)
      );
      const activeIds = new Set(activeShotIds(state));
      const preservedInactiveShotIds =
        next === undefined ? [] : currentShotIds.filter((shotId) => !activeIds.has(shotId));
      const subject = referenceEntity(next ?? current!, next === undefined ? null : index + 1);
      const fields: ProposalReviewField[] = [
        {
          key: 'referenceKind',
          ...(current === undefined ? {} : { before: { kind: 'referenceKind' as const, value: current.kind } }),
          after: { kind: 'referenceKind', value: next?.kind ?? null },
        },
        {
          key: 'title',
          ...(current === undefined ? {} : { before: text(current.label) }),
          after: text(next?.label ?? null),
        },
        {
          key: 'referencePrompt',
          ...(current === undefined ? {} : { before: text(current.prompt) }),
          after: text(next?.prompt ?? null),
        },
        {
          key: 'assignedShots',
          ...(current === undefined
            ? {}
            : { before: entities(currentShotIds.map((shotId) => shotEntity(state, shotId))) }),
          after: entities(
            [...(next?.shotIds ?? []), ...preservedInactiveShotIds].map((shotId) => shotEntity(state, shotId))
          ),
        },
      ];
      return [{ subject, fields }];
    }),
  };
};

const applyReferenceOperation = (
  state: ReviewState,
  operation: Extract<ReviewableProposalOperation, { kind: 'set_project_references' }>
): void => {
  state.referenceOrder = operation.references.map((reference) => reference.id);
  state.references = new Map(
    operation.references.map((reference) => [
      reference.id,
      { id: reference.id, kind: reference.kind, label: reference.label, prompt: reference.prompt },
    ])
  );
  const assignments = new Map<string, string[]>();
  for (const reference of operation.references) {
    for (const shotId of reference.shotIds) {
      const held = assignments.get(shotId) ?? [];
      held.push(reference.id);
      assignments.set(shotId, held);
    }
  }
  const activeIds = new Set(activeShotIds(state));
  const nextReferenceIds = new Set(operation.references.map((reference) => reference.id));
  for (const shot of state.shots.values()) {
    shot.referenceIds = activeIds.has(shot.id)
      ? (assignments.get(shot.id) ?? [])
      : shot.referenceIds.filter((referenceId) => nextReferenceIds.has(referenceId));
  }
};

const sameStringOrder = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sameBinItem = (
  left: StudioRendererProjectV2['bin'][number],
  right: StudioRendererProjectV2['bin'][number]
): boolean => {
  if (left.kind !== right.kind || left.reason !== right.reason || left.beatId !== right.beatId) return false;
  return left.kind === 'beat' || (right.kind === 'shot' && left.shotId === right.shotId);
};

const binIdentity = (item: StudioRendererProjectV2['bin'][number]): string =>
  item.kind === 'beat' ? `beat\0${item.beatId}` : `shot\0${item.beatId}\0${item.shotId}`;

const canReviewBinOrder = (
  state: ReviewState,
  operation: Extract<ReviewableProposalOperation, { kind: 'reorder_bin' }>
) => {
  if (state.bin.length !== operation.bin.length) return false;
  const currentByIdentity = new Map(state.bin.map((item) => [binIdentity(item), item]));
  if (currentByIdentity.size !== state.bin.length) return false;
  if (
    operation.bin.some((item) => {
      const current = currentByIdentity.get(binIdentity(item));
      return current === undefined || !sameBinItem(current, item);
    })
  ) {
    return false;
  }
  return operation.bin.some((item, index) => binIdentity(item) !== binIdentity(state.bin[index]!));
};

const sameProposedShotFields = (shot: ReviewShot, proposed: StudioProposedShot): boolean =>
  shot.line === proposed.line &&
  shot.narration === proposed.narration &&
  shot.onScreenText === proposed.onScreenText &&
  shot.durationSeconds === proposed.durationSeconds &&
  shot.chainBreak === proposed.chainBreak;

const reasonsAreCanonical = (reasons: readonly StudioFixedShotReasonV2[]): boolean =>
  reasons.length > 0 &&
  new Set(reasons).size === reasons.length &&
  reasons.every(
    (reason, index) =>
      index === 0 || FIXED_REASON_ORDER.indexOf(reasons[index - 1]!) < FIXED_REASON_ORDER.indexOf(reason)
  );

const canReviewCoverage = (
  state: ReviewState,
  operation: Extract<ReviewableProposalOperation, { kind: 'apply_coverage' }>
): boolean => {
  const beat = state.beats.get(operation.beatId);
  if (beat === undefined || !state.beatOrder.includes(operation.beatId)) return false;
  const proposedIds = operation.shots.map((shot) => shot.shotId);
  if (new Set(proposedIds).size !== proposedIds.length) return false;
  const currentIds = new Set(beat.shotOrder);
  for (const proposed of operation.shots) {
    const current = state.shots.get(proposed.shotId);
    if (current === undefined) {
      if (state.knownShotIds.has(proposed.shotId) || proposed.chainBreak === 'hard_cut') return false;
      continue;
    }
    if (!currentIds.has(proposed.shotId) || current.chainBreak !== proposed.chainBreak) return false;
  }

  const fixedById = new Map(operation.fixedShots.map((fixed) => [fixed.shotId, fixed]));
  if (fixedById.size !== operation.fixedShots.length) return false;
  let previousFixedPosition = -1;
  for (const fixed of operation.fixedShots) {
    const currentPosition = beat.shotOrder.indexOf(fixed.shotId);
    const current = state.shots.get(fixed.shotId);
    const proposed = operation.shots.find((shot) => shot.shotId === fixed.shotId);
    if (
      current === undefined ||
      proposed === undefined ||
      currentPosition <= previousFixedPosition ||
      !reasonsAreCanonical(fixed.reasons) ||
      !sameProposedShotFields(current, proposed)
    ) {
      return false;
    }
    previousFixedPosition = currentPosition;
    const observable = fixed.reasons.filter((reason) => !OPAQUE_FIXED_REASONS.has(reason));
    if (!sameStringOrder(observable, current.observableFixedReasons)) return false;
  }
  for (const shotId of beat.shotOrder) {
    const shot = state.shots.get(shotId);
    if (shot !== undefined && shot.observableFixedReasons.length > 0 && !fixedById.has(shotId)) return false;
  }

  const currentStart = new Map<string, number>();
  let cursor = 0;
  for (const shotId of beat.shotOrder) {
    currentStart.set(shotId, cursor);
    const shot = state.shots.get(shotId);
    if (shot === undefined) return false;
    cursor += shot.durationSeconds;
  }
  cursor = 0;
  for (const proposed of operation.shots) {
    if (fixedById.has(proposed.shotId) && currentStart.get(proposed.shotId) !== cursor) return false;
    cursor += proposed.durationSeconds;
  }
  return operation.fixedShots.every((fixed) => proposedIds.includes(fixed.shotId));
};

const canReviewOperation = (state: ReviewState, operation: ReviewableProposalOperation): boolean => {
  switch (operation.kind) {
    case 'set_brief':
      return true;
    case 'set_project_references': {
      const referenceIds = operation.references.map((reference) => reference.id);
      const activePositions = new Map(activeShotIds(state).map((shotId, index) => [shotId, index]));
      const backgroundShotIds = new Set<string>();
      return (
        new Set(referenceIds).size === referenceIds.length &&
        operation.references.every((reference) => {
          let previousPosition = -1;
          return (
            new Set(reference.shotIds).size === reference.shotIds.length &&
            reference.shotIds.every((shotId) => {
              const position = activePositions.get(shotId);
              if (position === undefined || position <= previousPosition) return false;
              if (reference.kind === 'background') {
                if (backgroundShotIds.has(shotId)) return false;
                backgroundShotIds.add(shotId);
              }
              previousPosition = position;
              return true;
            })
          );
        })
      );
    }
    case 'add_beat':
      return (
        !state.knownBeatIds.has(operation.beatId) &&
        (operation.beforeBeatId === null || state.beatOrder.includes(operation.beforeBeatId))
      );
    case 'add_binned_beat':
      return !state.knownBeatIds.has(operation.beatId);
    case 'edit_beat':
      return state.beats.has(operation.beatId);
    case 'reorder_beats':
      return isExactIdentityOrder(state.beatOrder, operation.beatOrder);
    case 'add_shot': {
      const beat = state.beats.get(operation.beatId);
      return (
        beat !== undefined &&
        !state.knownShotIds.has(operation.shotId) &&
        (operation.beforeShotId === null || beat.shotOrder.includes(operation.beforeShotId))
      );
    }
    case 'edit_shot':
      return state.shots.has(operation.shotId);
    case 'delete_shot': {
      const shot = state.shots.get(operation.shotId);
      return activeShotIds(state).includes(operation.shotId) && shot?.observableFixedReasons.length === 0;
    }
    case 'redetach_line':
    case 'rederive_line':
      return activeShotIds(state).includes(operation.shotId);
    case 'reorder_shots': {
      const beat = state.beats.get(operation.beatId);
      return beat !== undefined && isExactIdentityOrder(beat.shotOrder, operation.shotOrder);
    }
    case 'apply_coverage':
      return canReviewCoverage(state, operation);
    case 'reorder_bin':
      return (
        operation.bin.every((item) =>
          item.kind === 'beat'
            ? state.beats.has(item.beatId)
            : state.beats.has(item.beatId) && state.shots.has(item.shotId)
        ) && canReviewBinOrder(state, operation)
      );
  }
};

const reviewOperation = (state: ReviewState, operation: ReviewableProposalOperation): ProposalOperationReview => {
  switch (operation.kind) {
    case 'set_brief': {
      const review: ProposalOperationReview = {
        kind: 'fields',
        operationKind: operation.kind,
        subject: null,
        fields: [{ key: 'brief', before: text(state.brief), after: text(operation.brief) }],
      };
      state.brief = operation.brief;
      return review;
    }
    case 'set_project_references': {
      const review = reviewReferences(state, operation);
      applyReferenceOperation(state, operation);
      return review;
    }
    case 'add_beat': {
      const before = beforePlacement(state, operation.beforeBeatId, 'beat');
      state.beats.set(operation.beatId, { id: operation.beatId, ...operation.beat, shotOrder: [] });
      state.knownBeatIds.add(operation.beatId);
      insertBefore(state.beatOrder, operation.beatId, operation.beforeBeatId);
      return {
        kind: 'fields',
        operationKind: operation.kind,
        subject: beatEntity(state, operation.beatId),
        fields: [...authoredBeatFields(operation.beat), { key: 'placement', after: before }],
      };
    }
    case 'add_binned_beat': {
      state.beats.set(operation.beatId, { id: operation.beatId, ...operation.beat, shotOrder: [] });
      state.knownBeatIds.add(operation.beatId);
      state.bin.push({ kind: 'beat', beatId: operation.beatId, reason: 'alternate' });
      return {
        kind: 'fields',
        operationKind: operation.kind,
        subject: beatEntity(state, operation.beatId),
        fields: [
          ...authoredBeatFields(operation.beat),
          { key: 'placement', after: placement({ kind: 'placement', value: 'bin' }) },
        ],
      };
    }
    case 'edit_beat': {
      const beat = state.beats.get(operation.beatId)!;
      const fields: ProposalReviewField[] = [];
      for (const key of ['title', 'action', 'look', 'targetSeconds'] as const) {
        if (!Object.hasOwn(operation.changes, key)) continue;
        fields.push({
          key,
          before: key === 'targetSeconds' ? number(beat.targetSeconds) : text(beat[key]),
          after:
            key === 'targetSeconds'
              ? number(operation.changes.targetSeconds ?? null)
              : text(operation.changes[key] ?? null),
        });
      }
      Object.assign(beat, operation.changes);
      return { kind: 'fields', operationKind: operation.kind, subject: beatEntity(state, beat.id), fields };
    }
    case 'reorder_beats': {
      const before = entities(state.beatOrder.map((beatId) => beatEntity(state, beatId)));
      state.beatOrder = [...operation.beatOrder];
      return {
        kind: 'fields',
        operationKind: operation.kind,
        subject: null,
        fields: [{ key: 'order', before, after: entities(state.beatOrder.map((beatId) => beatEntity(state, beatId))) }],
      };
    }
    case 'add_shot': {
      const before = beforePlacement(state, operation.beforeShotId, 'shot');
      state.shots.set(operation.shotId, {
        id: operation.shotId,
        ownerBeatId: operation.beatId,
        ...operation.shot,
        chainBreak: 'none',
        referenceIds: [],
        observableFixedReasons: updateAuthoredFixedReasons([], operation.shot),
      });
      state.knownShotIds.add(operation.shotId);
      insertBefore(state.beats.get(operation.beatId)!.shotOrder, operation.shotId, operation.beforeShotId);
      return {
        kind: 'fields',
        operationKind: operation.kind,
        subject: shotEntity(state, operation.shotId),
        fields: [
          { key: 'ownerBeat', after: entities([beatEntity(state, operation.beatId)]) },
          { key: 'placement', after: before },
          ...authoredShotFields(operation.shot),
        ],
      };
    }
    case 'edit_shot': {
      const shot = state.shots.get(operation.shotId)!;
      const fields: ProposalReviewField[] = [];
      for (const key of ['line', 'narration', 'onScreenText', 'durationSeconds'] as const) {
        if (!Object.hasOwn(operation.changes, key)) continue;
        fields.push({
          key,
          before: key === 'durationSeconds' ? number(shot.durationSeconds) : text(shot[key]),
          after:
            key === 'durationSeconds'
              ? number(operation.changes.durationSeconds ?? null)
              : text(operation.changes[key] ?? null),
        });
      }
      Object.assign(shot, operation.changes);
      shot.observableFixedReasons = updateAuthoredFixedReasons(shot.observableFixedReasons, shot);
      return { kind: 'fields', operationKind: operation.kind, subject: shotEntity(state, shot.id), fields };
    }
    case 'delete_shot': {
      const subject = shotEntity(state, operation.shotId);
      const shot = state.shots.get(operation.shotId)!;
      const fields = removedShotFields(shot);
      const owner = shot.ownerBeatId;
      if (owner !== null && owner !== undefined) {
        const beat = state.beats.get(owner);
        if (beat !== undefined) beat.shotOrder = beat.shotOrder.filter((shotId) => shotId !== operation.shotId);
      }
      state.shots.delete(operation.shotId);
      return { kind: 'fields', operationKind: operation.kind, subject, fields };
    }
    case 'reorder_shots': {
      const beat = state.beats.get(operation.beatId)!;
      const before = entities(beat.shotOrder.map((shotId) => shotEntity(state, shotId)));
      beat.shotOrder = [...operation.shotOrder];
      return {
        kind: 'fields',
        operationKind: operation.kind,
        subject: beatEntity(state, beat.id),
        fields: [{ key: 'order', before, after: entities(beat.shotOrder.map((shotId) => shotEntity(state, shotId))) }],
      };
    }
    case 'apply_coverage': {
      const beat = beatEntity(state, operation.beatId);
      const owner = state.beats.get(operation.beatId)!;
      const beforeOrder = [...owner.shotOrder];
      const beforeShots = new Map(
        beforeOrder.map((shotId) => {
          const shot = state.shots.get(shotId)!;
          return [
            shotId,
            { ...shot, referenceIds: [...shot.referenceIds], observableFixedReasons: [...shot.observableFixedReasons] },
          ];
        })
      );
      const beforeEntities = new Map(beforeOrder.map((shotId) => [shotId, shotEntity(state, shotId)]));
      const proposedIds = operation.shots.map((shot) => shot.shotId);
      const proposedSet = new Set(proposedIds);
      for (const removedId of owner.shotOrder) {
        if (!proposedSet.has(removedId)) state.shots.delete(removedId);
      }
      for (const proposed of operation.shots) {
        const current = state.shots.get(proposed.shotId);
        state.shots.set(proposed.shotId, {
          id: proposed.shotId,
          ownerBeatId: operation.beatId,
          line: proposed.line,
          narration: proposed.narration,
          onScreenText: proposed.onScreenText,
          durationSeconds: proposed.durationSeconds,
          chainBreak: proposed.chainBreak,
          referenceIds: [...(current?.referenceIds ?? [])],
          observableFixedReasons: updateAuthoredFixedReasons(current?.observableFixedReasons ?? [], proposed),
        });
        state.knownShotIds.add(proposed.shotId);
      }
      owner.shotOrder = proposedIds;
      const afterEntities = new Map(proposedIds.map((shotId) => [shotId, shotEntity(state, shotId)]));
      const reviewIds = [...proposedIds, ...beforeOrder.filter((shotId) => !proposedSet.has(shotId))];
      return {
        kind: 'coverage',
        operationKind: operation.kind,
        beat,
        order: {
          key: 'order',
          before: entities(beforeOrder.map((shotId) => beforeEntities.get(shotId)!)),
          after: entities(proposedIds.map((shotId) => afterEntities.get(shotId)!)),
        },
        shots: reviewIds.map((shotId) => {
          const before = beforeShots.get(shotId);
          const after = operation.shots.find((shot) => shot.shotId === shotId);
          const beforeEntity = beforeEntities.get(shotId);
          const afterEntity = afterEntities.get(shotId);
          return {
            change: before === undefined ? ('added' as const) : after === undefined ? ('removed' as const) : 'retained',
            subject: afterEntity ?? beforeEntity!,
            fields: coverageShotFields(before, after, beforeEntity, afterEntity),
          };
        }),
        fixedShots: operation.fixedShots,
      };
    }
    case 'redetach_line':
    case 'rederive_line': {
      const shot = state.shots.get(operation.shotId)!;
      const subject = shotEntity(state, shot.id);
      const before = shot.line;
      shot.line = operation.line;
      return {
        kind: 'fields',
        operationKind: operation.kind,
        subject,
        fields: [{ key: 'line', before: text(before), after: text(operation.line) }],
      };
    }
    case 'reorder_bin': {
      const itemEntity = (item: StudioRendererProjectV2['bin'][number]): ProposalReviewEntity =>
        item.kind === 'beat' ? beatEntity(state, item.beatId) : shotEntity(state, item.shotId);
      const before = entities(state.bin.map(itemEntity));
      state.bin = operation.bin.map((item) => ({ ...item }));
      return {
        kind: 'fields',
        operationKind: operation.kind,
        subject: null,
        fields: [{ key: 'order', before, after: entities(state.bin.map(itemEntity)) }],
      };
    }
  }
};

/** Builds exact sequential before/after review state, or fails closed for a non-Director operation. */
export const buildProposalReview = (
  project: StudioRendererProjectV2,
  operations: readonly StudioMutationOperationV2[]
): ProposalOperationReview[] | null => {
  if (!operations.every(isReviewableProposalOperation)) return null;
  const state = initialReviewState(project);
  const reviews: ProposalOperationReview[] = [];
  try {
    for (const operation of operations) {
      if (!canReviewOperation(state, operation)) return null;
      reviews.push(reviewOperation(state, operation));
    }
    return reviews;
  } catch {
    return null;
  }
};
