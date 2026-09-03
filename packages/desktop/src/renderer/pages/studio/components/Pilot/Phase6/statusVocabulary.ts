/**
 * Canvas-scoped status presentation contract from signed Phase 6 Ruling 2.
 *
 * Main owns legality, staleness, and the actions a person may take. The renderer
 * only maps canonical tokens and already-projected actions to translated copy.
 */

import {
  STUDIO_CANVAS_BLOCK_STATUSES_V4,
  STUDIO_CANVAS_MEMBER_STATUSES_V4,
  type StudioCanvasBlockStatusV4,
  type StudioCanvasFailureActionV4,
  type StudioCanvasFailureCostTruthV4,
  type StudioCanvasFailureReasonV4,
  type StudioCanvasMemberStatusV4,
  type StudioCanvasRecoveryActionV4,
  type StudioCanvasStaleActionV4,
} from '@/common/types/project/creativeStudioTypes';

export const STATUS_I18N_ROOT = 'conversation.creativeStudio.pilot.canvas.status';
export type StudioStatusLevel = 'block' | 'member';

type StatusBehavior = Readonly<{ showsConditions: boolean; cancellableForRefund: boolean }>;

const QUIET: StatusBehavior = { showsConditions: false, cancellableForRefund: false };
const PROVIDER_WORK: StatusBehavior = { showsConditions: true, cancellableForRefund: true };
const CONDITIONS_ONLY: StatusBehavior = { showsConditions: true, cancellableForRefund: false };

/** Exhaustive by level: adding a canonical status requires an explicit classification here. */
export const STATUS_BEHAVIOR = {
  member: {
    slate: QUIET,
    queued: QUIET,
    ready_to_render: QUIET,
    generating: PROVIDER_WORK,
    rendered: QUIET,
    stale: QUIET,
    failed: QUIET,
  } satisfies Readonly<Record<StudioCanvasMemberStatusV4, StatusBehavior>>,
  block: {
    needs_budget: CONDITIONS_ONLY,
    proposed: CONDITIONS_ONLY,
    partial: QUIET,
    drafted: QUIET,
    rendered: QUIET,
    imported: QUIET,
    current: QUIET,
    stale: QUIET,
    failed: QUIET,
    queued: QUIET,
    generating: PROVIDER_WORK,
    rendering: QUIET,
  } satisfies Readonly<Record<StudioCanvasBlockStatusV4, StatusBehavior>>,
} as const;

const key = <T extends string>(suffix: T): `${typeof STATUS_I18N_ROOT}.${T}` => `${STATUS_I18N_ROOT}.${suffix}`;

export const STATUS_KEYS = {
  member: Object.fromEntries(
    STUDIO_CANVAS_MEMBER_STATUSES_V4.map((status) => [status, key(`member.${status}`)])
  ) as Readonly<Record<StudioCanvasMemberStatusV4, string>>,
  block: Object.fromEntries(
    STUDIO_CANVAS_BLOCK_STATUSES_V4.map((status) => [status, key(`block.${status}`)])
  ) as Readonly<Record<StudioCanvasBlockStatusV4, string>>,
};

export const FAILURE_REASON_KEYS = {
  rule_breach: key('failure.reason.rule_breach'),
  returned_silence: key('failure.reason.returned_silence'),
  provider_failure: key('failure.reason.provider_failure'),
  local_render_failure: key('failure.reason.local_render_failure'),
  download_failure: key('failure.reason.download_failure'),
} as const satisfies Readonly<Record<StudioCanvasFailureReasonV4, string>>;

export const FAILURE_COST_KEYS = {
  spent: key('failure.cost.spent'),
  not_spent: key('failure.cost.not_spent'),
} as const satisfies Readonly<Record<StudioCanvasFailureCostTruthV4, string>>;

export const RECOVERY_ACTION_KEYS = {
  re_render_chain: key('action.re_render_chain'),
  keep: key('action.keep'),
  retry: key('action.retry'),
} as const satisfies Readonly<Record<StudioCanvasRecoveryActionV4, string>>;

// These assertions keep both constituent action unions visibly tied to the complete map.
const _staleActionKeys: Readonly<Record<StudioCanvasStaleActionV4, string>> = RECOVERY_ACTION_KEYS;
const _failureActionKeys: Readonly<Record<StudioCanvasFailureActionV4, string>> = RECOVERY_ACTION_KEYS;
void _staleActionKeys;
void _failureActionKeys;

export const FAILURE_LINE_KEY = key('failure.line');
export const QUEUED_POSITION_KEY = key('queuedPosition');

export const statusKey = <L extends StudioStatusLevel>(
  level: L,
  status: L extends 'block' ? StudioCanvasBlockStatusV4 : StudioCanvasMemberStatusV4
): string => STATUS_KEYS[level][status as never];

/** Maps actions already projected by Main; it never invents or widens the action set. */
export const recoveryActionKeys = (actions: readonly StudioCanvasRecoveryActionV4[]): readonly string[] =>
  actions.map((action) => RECOVERY_ACTION_KEYS[action]);

export const allStatusI18nKeys = (): readonly string[] => [
  ...Object.values(STATUS_KEYS.block),
  ...Object.values(STATUS_KEYS.member),
  FAILURE_LINE_KEY,
  ...Object.values(FAILURE_REASON_KEYS),
  ...Object.values(FAILURE_COST_KEYS),
  ...Object.values(RECOVERY_ACTION_KEYS),
  QUEUED_POSITION_KEY,
];
