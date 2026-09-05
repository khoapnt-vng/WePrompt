import { describe, expect, it } from 'vitest';

import type { StudioProjectStatusStageIdV2, StudioProjectStatusV2 } from '@/common/types/project/creativeStudioTypes';
import { deriveStudioWorkspaceProgress } from '@/renderer/pages/studio/components/Workspace/workspaceProjection';

const status = (): StudioProjectStatusV2 => ({
  projectId: 'project_1',
  projectRevision: 4,
  catalogVersion: 'catalog_1',
  blockerCount: 0,
  advisories: [{ cause: 'next_action', stage: 'production' }],
  boards: { currentPictureCount: 0, shotCount: 4 },
  detail: null,
  stages: [
    {
      id: 'brief',
      state: 'complete',
      summary: { stage: 'brief', hasBrief: true },
      blockers: [],
    },
    {
      id: 'engines',
      state: 'complete',
      summary: { stage: 'engines', image: 'ready', video: 'ready' },
      blockers: [],
    },
    {
      id: 'references',
      state: 'complete',
      summary: { stage: 'references', plannedCount: 0, approvedCount: 0 },
      blockers: [],
    },
    {
      id: 'storyboard',
      state: 'complete',
      summary: {
        stage: 'storyboard',
        beatCount: 1,
        shotCount: 4,
        authoredShotCount: 4,
        plannedSeconds: 18,
        targetSeconds: 18,
      },
      blockers: [],
    },
    {
      id: 'bindings',
      state: 'complete',
      summary: { stage: 'bindings', readyShotCount: 4, shotCount: 4, maxConditioningImages: 3 },
      blockers: [],
    },
    {
      id: 'production',
      state: 'not_started',
      summary: { stage: 'production', currentTakeCount: 0, shotCount: 4, activeJobCount: 0 },
      blockers: [],
    },
    {
      id: 'cut',
      state: 'not_started',
      summary: {
        stage: 'cut',
        currentTakeCount: 0,
        shotCount: 4,
        durationSeconds: null,
        targetSeconds: 18,
        structurallyPlayable: false,
      },
      blockers: [],
    },
  ],
});

const blockedStatus = (stageId: StudioProjectStatusStageIdV2, blocker: unknown): StudioProjectStatusV2 => {
  const blocked = status();
  blocked.advisories = [];
  blocked.blockerCount = 1;
  const stage = blocked.stages.find((candidate) => candidate.id === stageId)!;
  stage.state = 'blocked';
  stage.blockers = [blocker] as never;
  return blocked;
};

const shotWhere = () => ({
  kind: 'shot' as const,
  beatId: 'beat_1',
  shotId: 'shot_1',
  beatPosition: 1,
  shotPosition: 1,
  jobId: null,
});

const sparseArray = <Value>(): Value[] => {
  const values: Value[] = [];
  values.length = 1;
  return values;
};

describe('deriveStudioWorkspaceProgress', () => {
  it('distinguishes the useful Table from three empty peers and recommends Board', () => {
    const progress = deriveStudioWorkspaceProgress(status(), 'project_1', 4);

    expect(progress).toEqual(
      expect.objectContaining({
        nextAction: { stage: 'production', view: 'board' },
        views: expect.objectContaining({
          references: expect.objectContaining({ readiness: 'empty', recommended: false }),
          table: expect.objectContaining({ readiness: 'ready', recommended: false }),
          board: expect.objectContaining({
            readiness: 'not_started',
            recommended: true,
            currentCount: 0,
            totalCount: 4,
          }),
          cut: expect.objectContaining({
            readiness: 'not_started',
            recommended: false,
            currentCount: 0,
            totalCount: 4,
          }),
        }),
      })
    );
  });

  it('keeps a Board with drawn panels useful while still identifying production as next', () => {
    const withPanels = status();
    withPanels.boards.currentPictureCount = 4;

    expect(deriveStudioWorkspaceProgress(withPanels, 'project_1', 4)?.views.board).toMatchObject({
      readiness: 'ready',
      recommended: true,
      currentCount: 0,
      totalCount: 4,
    });
  });

  it('reports binding progress, not authored-shot progress, once Table advances to bindings', () => {
    const binding = status();
    const bindings = binding.stages.find((candidate) => candidate.id === 'bindings')!;
    bindings.state = 'in_progress';
    bindings.summary = { stage: 'bindings', readyShotCount: 1, shotCount: 4, maxConditioningImages: 3 };
    binding.advisories = [{ cause: 'next_action', stage: 'bindings' }];

    expect(deriveStudioWorkspaceProgress(binding, 'project_1', 4)?.views.table).toMatchObject({
      stage: 'bindings',
      state: 'in_progress',
      currentCount: 1,
      totalCount: 4,
      recommended: true,
    });
  });

  it('tracks in-progress and complete production without inventing another action', () => {
    const inProgress = status();
    const production = inProgress.stages.find((candidate) => candidate.id === 'production')!;
    production.state = 'in_progress';
    production.summary = { stage: 'production', currentTakeCount: 2, shotCount: 4, activeJobCount: 0 };
    const inProgressCut = inProgress.stages.find((candidate) => candidate.id === 'cut')!;
    inProgressCut.state = 'in_progress';
    inProgressCut.summary = {
      stage: 'cut',
      currentTakeCount: 2,
      shotCount: 4,
      durationSeconds: null,
      targetSeconds: 18,
      structurallyPlayable: false,
    };
    expect(deriveStudioWorkspaceProgress(inProgress, 'project_1', 4)?.views.board).toMatchObject({
      readiness: 'ready',
      recommended: true,
      currentCount: 2,
    });

    const complete = status();
    complete.advisories = [];
    const completeProduction = complete.stages.find((candidate) => candidate.id === 'production')!;
    completeProduction.state = 'complete';
    completeProduction.summary = { stage: 'production', currentTakeCount: 4, shotCount: 4, activeJobCount: 0 };
    const completeCut = complete.stages.find((candidate) => candidate.id === 'cut')!;
    completeCut.state = 'complete';
    completeCut.summary = {
      stage: 'cut',
      currentTakeCount: 4,
      shotCount: 4,
      durationSeconds: 18,
      targetSeconds: 18,
      structurallyPlayable: true,
    };
    expect(deriveStudioWorkspaceProgress(complete, 'project_1', 4)).toMatchObject({
      nextAction: null,
      views: { board: { readiness: 'ready', recommended: false }, cut: { readiness: 'ready' } },
    });
  });

  it('does not recommend around blockers and keeps the blocked view inspectable', () => {
    const blocked = status();
    blocked.advisories = [];
    blocked.blockerCount = 1;
    const production = blocked.stages.find((candidate) => candidate.id === 'production')!;
    production.state = 'blocked';
    production.blockers = [
      {
        cause: 'seed_selection_required',
        where: { kind: 'shot', beatId: 'beat_1', shotId: 'shot_1', beatPosition: 1, shotPosition: 1, jobId: null },
        remedy: { kind: 'owner_only', reason: 'select_seed' },
      },
    ];

    expect(deriveStudioWorkspaceProgress(blocked, 'project_1', 4)).toMatchObject({
      nextAction: null,
      views: { board: { readiness: 'ready', state: 'blocked', recommended: false } },
    });
  });

  it('accepts a blocked engine stage whose selected routes are otherwise ready', () => {
    const blocked = blockedStatus('engines', {
      cause: 'route_incompatible_frame',
      where: { kind: 'route', routeKind: 'video' },
      remedy: { kind: 'owner_only', reason: 'choose_compatible_engine' },
    });

    expect(deriveStudioWorkspaceProgress(blocked, 'project_1', 4)).toMatchObject({
      nextAction: null,
      views: {
        references: { recommended: false },
        table: { recommended: false },
        board: { recommended: false },
        cut: { recommended: false },
      },
    });
  });

  it.each([
    [
      'an extra nested location field',
      'engines',
      {
        cause: 'route_not_selected',
        where: { kind: 'route', routeKind: 'video', leaked: true },
        remedy: { kind: 'owner_only', reason: 'select_engine' },
      },
    ],
    [
      'an unknown owner-only reason',
      'production',
      {
        cause: 'seed_selection_required',
        where: shotWhere(),
        remedy: { kind: 'owner_only', reason: 'pick_something' },
      },
    ],
    [
      'a malformed nested generation choice',
      'production',
      {
        cause: 'seed_generation_required',
        where: shotWhere(),
        remedy: {
          kind: 'proposal',
          prepare: {
            kind: 'generation',
            baseChoices: [
              {
                target: { kind: 'shot', shotId: 'shot_1', leaked: true },
                purpose: 'seed_still',
              },
            ],
            cascadeChoices: [],
            continuityChange: null,
          },
          estimatedMinorUnits: null,
          currency: null,
        },
      },
    ],
    [
      'a cause and location mismatch',
      'engines',
      {
        cause: 'route_not_selected',
        where: { kind: 'project' },
        remedy: { kind: 'owner_only', reason: 'select_engine' },
      },
    ],
    [
      'a free-fix target mismatch',
      'bindings',
      {
        cause: 'reference_binding_unassigned',
        where: shotWhere(),
        remedy: { kind: 'free_fix', op: 'set_shot_reference_binding', shotId: 'shot_2' },
      },
    ],
    [
      'a proposal and reference location mismatch',
      'references',
      {
        cause: 'reference_generation_required',
        where: { kind: 'reference', referenceId: 'reference_1', jobId: null },
        remedy: {
          kind: 'proposal',
          prepare: { kind: 'project_references', referenceIds: ['reference_2'] },
          estimatedMinorUnits: null,
          currency: null,
        },
      },
    ],
  ] as const)('fails closed for %s', (_case, stageId, blocker) => {
    expect(deriveStudioWorkspaceProgress(blockedStatus(stageId, blocker), 'project_1', 4)).toBeNull();
  });

  it('fails closed for sparse blocker, advisory, and advisory-detail arrays', () => {
    const sparseBlockers = status();
    const production = sparseBlockers.stages.find((candidate) => candidate.id === 'production')!;
    production.state = 'blocked';
    production.blockers = sparseArray() as never;
    sparseBlockers.blockerCount = 1;
    sparseBlockers.advisories = [];
    expect(deriveStudioWorkspaceProgress(sparseBlockers, 'project_1', 4)).toBeNull();

    const sparseAdvisories = blockedStatus('engines', {
      cause: 'route_incompatible_frame',
      where: { kind: 'route', routeKind: 'video' },
      remedy: { kind: 'owner_only', reason: 'choose_compatible_engine' },
    });
    sparseAdvisories.advisories = sparseArray() as never;
    expect(deriveStudioWorkspaceProgress(sparseAdvisories, 'project_1', 4)).toBeNull();

    const sparseStaleCauses = status();
    sparseStaleCauses.advisories = [
      { cause: 'next_action', stage: 'production' },
      {
        cause: 'current_take_stale',
        stage: 'production',
        shotId: 'shot_1',
        staleCauses: sparseArray(),
      },
    ] as never;
    expect(deriveStudioWorkspaceProgress(sparseStaleCauses, 'project_1', 4)).toBeNull();
  });

  it('fails closed for stale, inconsistent, or malformed status authority', () => {
    expect(deriveStudioWorkspaceProgress(null, 'project_1', 4)).toBeNull();
    expect(deriveStudioWorkspaceProgress(status(), 'project_2', 4)).toBeNull();
    expect(deriveStudioWorkspaceProgress(status(), 'project_1', 5)).toBeNull();
    expect(deriveStudioWorkspaceProgress({ ...status(), blockerCount: 1 }, 'project_1', 4)).toBeNull();
    expect(deriveStudioWorkspaceProgress({ ...status(), advisories: [] }, 'project_1', 4)).toBeNull();
    expect(
      deriveStudioWorkspaceProgress({ ...status(), boards: { currentPictureCount: 5, shotCount: 4 } }, 'project_1', 4)
    ).toBeNull();
    expect(
      deriveStudioWorkspaceProgress(
        { ...status(), advisories: [null] } as unknown as StudioProjectStatusV2,
        'project_1',
        4
      )
    ).toBeNull();
    const mismatchedCounts = status();
    const production = mismatchedCounts.stages.find((candidate) => candidate.id === 'production')!;
    production.summary = { stage: 'production', currentTakeCount: 0, shotCount: 3, activeJobCount: 0 };
    expect(deriveStudioWorkspaceProgress(mismatchedCounts, 'project_1', 4)).toBeNull();
    expect(
      deriveStudioWorkspaceProgress(
        {
          ...status(),
          advisories: [{ cause: 'next_action', stage: 'production' }, { cause: 'bogus' }],
        } as unknown as StudioProjectStatusV2,
        'project_1',
        4
      )
    ).toBeNull();

    const blockedWithoutBlocker = status();
    blockedWithoutBlocker.stages.find((candidate) => candidate.id === 'production')!.state = 'blocked';
    expect(deriveStudioWorkspaceProgress(blockedWithoutBlocker, 'project_1', 4)).toBeNull();

    const impossibleComplete = status();
    impossibleComplete.stages.find((candidate) => candidate.id === 'production')!.state = 'complete';
    impossibleComplete.advisories = [{ cause: 'next_action', stage: 'cut' }];
    expect(deriveStudioWorkspaceProgress(impossibleComplete, 'project_1', 4)).toBeNull();

    const relabeledReferences = status();
    relabeledReferences.stages.find((candidate) => candidate.id === 'references')!.state = 'in_progress';
    relabeledReferences.advisories = [{ cause: 'next_action', stage: 'references' }];
    expect(deriveStudioWorkspaceProgress(relabeledReferences, 'project_1', 4)).toBeNull();

    const relabeledBindings = status();
    relabeledBindings.stages.find((candidate) => candidate.id === 'bindings')!.state = 'in_progress';
    relabeledBindings.advisories = [{ cause: 'next_action', stage: 'bindings' }];
    expect(deriveStudioWorkspaceProgress(relabeledBindings, 'project_1', 4)).toBeNull();

    const relabeledProduction = status();
    const completeProduction = relabeledProduction.stages.find((candidate) => candidate.id === 'production')!;
    completeProduction.state = 'in_progress';
    completeProduction.summary = { stage: 'production', currentTakeCount: 4, shotCount: 4, activeJobCount: 0 };
    const completeProductionCut = relabeledProduction.stages.find((candidate) => candidate.id === 'cut')!;
    completeProductionCut.state = 'complete';
    completeProductionCut.summary = {
      stage: 'cut',
      currentTakeCount: 4,
      shotCount: 4,
      durationSeconds: 18,
      targetSeconds: 18,
      structurallyPlayable: true,
    };
    expect(deriveStudioWorkspaceProgress(relabeledProduction, 'project_1', 4)).toBeNull();

    const relabeledCut = status();
    const relabeledCutProduction = relabeledCut.stages.find((candidate) => candidate.id === 'production')!;
    relabeledCutProduction.state = 'complete';
    relabeledCutProduction.summary = {
      stage: 'production',
      currentTakeCount: 4,
      shotCount: 4,
      activeJobCount: 0,
    };
    const completeCut = relabeledCut.stages.find((candidate) => candidate.id === 'cut')!;
    completeCut.state = 'in_progress';
    completeCut.summary = {
      stage: 'cut',
      currentTakeCount: 4,
      shotCount: 4,
      durationSeconds: 18,
      targetSeconds: 18,
      structurallyPlayable: true,
    };
    relabeledCut.advisories = [{ cause: 'next_action', stage: 'cut' }];
    expect(deriveStudioWorkspaceProgress(relabeledCut, 'project_1', 4)).toBeNull();

    const contradictoryBrief = status();
    contradictoryBrief.stages.find((candidate) => candidate.id === 'brief')!.state = 'not_started';
    contradictoryBrief.advisories = [{ cause: 'next_action', stage: 'brief' }];
    expect(deriveStudioWorkspaceProgress(contradictoryBrief, 'project_1', 4)).toBeNull();

    const relabeledEmptyBrief = status();
    const emptyBrief = relabeledEmptyBrief.stages.find((candidate) => candidate.id === 'brief')!;
    emptyBrief.state = 'in_progress';
    emptyBrief.summary = { stage: 'brief', hasBrief: false };
    relabeledEmptyBrief.advisories = [{ cause: 'next_action', stage: 'brief' }];
    expect(deriveStudioWorkspaceProgress(relabeledEmptyBrief, 'project_1', 4)).toBeNull();

    const orphanStoryboardCounts = status();
    const emptyStoryboard = orphanStoryboardCounts.stages.find((candidate) => candidate.id === 'storyboard')!;
    emptyStoryboard.state = 'not_started';
    emptyStoryboard.summary = { ...emptyStoryboard.summary, beatCount: 0 };
    orphanStoryboardCounts.advisories = [{ cause: 'next_action', stage: 'storyboard' }];
    expect(deriveStudioWorkspaceProgress(orphanStoryboardCounts, 'project_1', 4)).toBeNull();

    const playableWithoutTakes = status();
    const impossibleCut = playableWithoutTakes.stages.find((candidate) => candidate.id === 'cut')!;
    impossibleCut.state = 'complete';
    impossibleCut.summary = {
      stage: 'cut',
      currentTakeCount: 0,
      shotCount: 4,
      durationSeconds: 18,
      targetSeconds: 18,
      structurallyPlayable: true,
    };
    expect(deriveStudioWorkspaceProgress(playableWithoutTakes, 'project_1', 4)).toBeNull();

    const plannedTimeWithoutShots = status();
    const noShotStoryboard = plannedTimeWithoutShots.stages.find((candidate) => candidate.id === 'storyboard')!;
    noShotStoryboard.state = 'in_progress';
    noShotStoryboard.summary = {
      stage: 'storyboard',
      beatCount: 1,
      shotCount: 0,
      authoredShotCount: 0,
      plannedSeconds: 18,
      targetSeconds: 18,
    };
    const noShotBindings = plannedTimeWithoutShots.stages.find((candidate) => candidate.id === 'bindings')!;
    noShotBindings.state = 'not_started';
    noShotBindings.summary = { stage: 'bindings', readyShotCount: 0, shotCount: 0, maxConditioningImages: 3 };
    plannedTimeWithoutShots.stages.find((candidate) => candidate.id === 'production')!.summary = {
      stage: 'production',
      currentTakeCount: 0,
      shotCount: 0,
      activeJobCount: 0,
    };
    plannedTimeWithoutShots.stages.find((candidate) => candidate.id === 'cut')!.summary = {
      stage: 'cut',
      currentTakeCount: 0,
      shotCount: 0,
      durationSeconds: null,
      targetSeconds: 18,
      structurallyPlayable: false,
    };
    plannedTimeWithoutShots.boards = { currentPictureCount: 0, shotCount: 0 };
    plannedTimeWithoutShots.advisories = [{ cause: 'next_action', stage: 'storyboard' }];
    expect(deriveStudioWorkspaceProgress(plannedTimeWithoutShots, 'project_1', 4)).toBeNull();

    const playableSlateWithoutBeat = status();
    const missingSlate = playableSlateWithoutBeat.stages.find((candidate) => candidate.id === 'storyboard')!;
    missingSlate.state = 'not_started';
    missingSlate.summary = {
      stage: 'storyboard',
      beatCount: 0,
      shotCount: 0,
      authoredShotCount: 0,
      plannedSeconds: 0,
      targetSeconds: 18,
    };
    const missingSlateBindings = playableSlateWithoutBeat.stages.find((candidate) => candidate.id === 'bindings')!;
    missingSlateBindings.state = 'not_started';
    missingSlateBindings.summary = { stage: 'bindings', readyShotCount: 0, shotCount: 0, maxConditioningImages: 3 };
    playableSlateWithoutBeat.stages.find((candidate) => candidate.id === 'production')!.summary = {
      stage: 'production',
      currentTakeCount: 0,
      shotCount: 0,
      activeJobCount: 0,
    };
    const falseSlateCut = playableSlateWithoutBeat.stages.find((candidate) => candidate.id === 'cut')!;
    falseSlateCut.state = 'complete';
    falseSlateCut.summary = {
      stage: 'cut',
      currentTakeCount: 0,
      shotCount: 0,
      durationSeconds: 18,
      targetSeconds: 18,
      structurallyPlayable: true,
    };
    playableSlateWithoutBeat.boards = { currentPictureCount: 0, shotCount: 0 };
    playableSlateWithoutBeat.advisories = [{ cause: 'next_action', stage: 'storyboard' }];
    expect(deriveStudioWorkspaceProgress(playableSlateWithoutBeat, 'project_1', 4)).toBeNull();

    const allTakesButUnplayable = status();
    const allTakeProduction = allTakesButUnplayable.stages.find((candidate) => candidate.id === 'production')!;
    allTakeProduction.state = 'complete';
    allTakeProduction.summary = { stage: 'production', currentTakeCount: 4, shotCount: 4, activeJobCount: 0 };
    const unplayableCut = allTakesButUnplayable.stages.find((candidate) => candidate.id === 'cut')!;
    unplayableCut.state = 'in_progress';
    unplayableCut.summary = {
      stage: 'cut',
      currentTakeCount: 4,
      shotCount: 4,
      durationSeconds: 18,
      targetSeconds: 18,
      structurallyPlayable: false,
    };
    allTakesButUnplayable.advisories = [{ cause: 'next_action', stage: 'cut' }];
    expect(deriveStudioWorkspaceProgress(allTakesButUnplayable, 'project_1', 4)).toBeNull();

    const invalidEngine = status();
    invalidEngine.stages.find((candidate) => candidate.id === 'engines')!.summary = {
      stage: 'engines',
      image: 'bogus',
      video: 'ready',
    } as never;
    expect(deriveStudioWorkspaceProgress(invalidEngine, 'project_1', 4)).toBeNull();

    const malformedBlocker = status();
    const malformedProduction = malformedBlocker.stages.find((candidate) => candidate.id === 'production')!;
    malformedProduction.state = 'blocked';
    malformedProduction.blockers = [{}] as never;
    malformedBlocker.blockerCount = 1;
    malformedBlocker.advisories = [];
    expect(deriveStudioWorkspaceProgress(malformedBlocker, 'project_1', 4)).toBeNull();
  });
});
