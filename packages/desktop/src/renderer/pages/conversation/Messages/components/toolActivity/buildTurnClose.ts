/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TurnWorkRecap, TurnWorkRecapStatus } from './buildTurnWorkRecap';
import type { NormalizedToolStatus } from '@/common/chat/normalizeToolCall';
import type { CoalescedStep } from '@/common/chat/toolActivity/types';

export type TurnCloseTone = 'neutral' | 'attention';

export type TurnClose = {
  // i18n key under messages.*; resolved by the component with useTranslation().
  key: string;
  tone: TurnCloseTone;
};

export type TurnDomainOutcome =
  | 'committed'
  | 'pending_review'
  | 'waiting_authorization'
  | 'action_required'
  | 'mixed_attention'
  | 'needs_revision'
  | 'refused'
  | 'failed'
  | 'canceled'
  | 'unconfirmed'
  | 'indeterminate'
  | 'observed'
  | 'unknown';

export type InterpretedToolOutcome =
  | TurnDomainOutcome
  | {
      outcome: TurnDomainOutcome;
      /** Durable command identity, when the bounded Studio output proves one. */
      commandId?: string;
      /** A command-status read that terminally resolves earlier uncertainty for this identity. */
      resolvesCommandId?: string;
    };

export type ToolOutcomeInterpreter = (input: {
  step: CoalescedStep;
  status: NormalizedToolStatus;
}) => InterpretedToolOutcome;

// Multiple variants per status keep the close from feeling same-y over time.
const CLOSE_VARIANTS: Record<Exclude<TurnWorkRecapStatus, 'active'>, string[]> = {
  completed: ['completed.v1', 'completed.v2', 'completed.v3'],
  recovered: ['recovered.v1', 'recovered.v2'],
  partial: ['partial.v1', 'partial.v2'],
  failed: ['failed.v1', 'failed.v2'],
  canceled: ['canceled.v1'],
};

const CLOSE_TONE: Record<Exclude<TurnWorkRecapStatus, 'active'>, TurnCloseTone> = {
  completed: 'neutral',
  recovered: 'neutral',
  partial: 'attention',
  failed: 'attention',
  canceled: 'neutral',
};

const DOMAIN_CLOSE: Record<TurnDomainOutcome, TurnClose> = {
  committed: { key: 'messages.toolActivity.close.studio.committed', tone: 'neutral' },
  pending_review: { key: 'messages.toolActivity.close.studio.pendingReview', tone: 'attention' },
  waiting_authorization: { key: 'messages.toolActivity.close.studio.waitingAuthorization', tone: 'attention' },
  action_required: { key: 'messages.toolActivity.close.studio.actionRequired', tone: 'attention' },
  mixed_attention: { key: 'messages.toolActivity.close.studio.mixedAttention', tone: 'attention' },
  needs_revision: { key: 'messages.toolActivity.close.studio.needsRevision', tone: 'attention' },
  refused: { key: 'messages.toolActivity.close.studio.refused', tone: 'attention' },
  failed: { key: 'messages.toolActivity.close.studio.failed', tone: 'attention' },
  canceled: { key: 'messages.toolActivity.close.studio.canceled', tone: 'neutral' },
  unconfirmed: { key: 'messages.toolActivity.close.studio.unconfirmed', tone: 'attention' },
  indeterminate: { key: 'messages.toolActivity.close.studio.indeterminate', tone: 'attention' },
  observed: { key: 'messages.toolActivity.close.studio.observed', tone: 'neutral' },
  unknown: { key: 'messages.toolActivity.close.studio.unknown', tone: 'attention' },
};

const DOMAIN_OUTCOME_PRIORITY: readonly TurnDomainOutcome[] = [
  'mixed_attention',
  'action_required',
  'indeterminate',
  'unconfirmed',
  'unknown',
  'failed',
  'canceled',
  'refused',
  'needs_revision',
  'waiting_authorization',
  'pending_review',
  'committed',
  'observed',
];

export const summarizeTurnDomainOutcomes = (interpreted: readonly InterpretedToolOutcome[]): TurnDomainOutcome => {
  const observations = interpreted.map((value) => (typeof value === 'string' ? { outcome: value } : value));
  const lastResolutionByCommandId = new Map<string, number>();
  observations.forEach((observation, index) => {
    if (observation.resolvesCommandId !== undefined) {
      lastResolutionByCommandId.set(observation.resolvesCommandId, index);
    }
  });
  const outcomes = observations.flatMap((observation, index) => {
    const laterResolution =
      observation.commandId === undefined ? undefined : lastResolutionByCommandId.get(observation.commandId);
    return laterResolution !== undefined && laterResolution > index ? [] : [observation.outcome];
  });
  const hasPendingReview = outcomes.includes('pending_review');
  const hasWaitingAuthorization = outcomes.includes('waiting_authorization');
  const hasHumanAction = hasPendingReview || hasWaitingAuthorization;
  const hasProblem = outcomes.some((outcome) =>
    ['needs_revision', 'refused', 'failed', 'canceled', 'unconfirmed', 'indeterminate', 'unknown'].includes(outcome)
  );
  if (hasHumanAction && hasProblem) return 'mixed_attention';
  if (hasPendingReview && hasWaitingAuthorization) return 'action_required';
  for (const candidate of DOMAIN_OUTCOME_PRIORITY) {
    if (outcomes.includes(candidate)) return candidate;
  }
  return 'unknown';
};

// Small deterministic hash so re-renders of the same turn pick the same variant.
const stableHash = (seed: string): number => {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
};

export const buildTurnClose = (
  recap: TurnWorkRecap,
  subject?: string,
  domainOutcome?: TurnDomainOutcome
): TurnClose | null => {
  // No sign-off while the work is still streaming.
  if (recap.status === 'active') return null;

  // Transport failures and cancellation still outrank an optimistic domain result: the turn itself
  // did not finish cleanly. Embedded domain surfaces get their own exact failure/cancellation copy;
  // generic chat keeps the existing close below.
  if (domainOutcome !== undefined) {
    if (recap.status === 'partial' || recap.status === 'failed' || recap.status === 'canceled') {
      if (domainOutcome === 'unconfirmed' || domainOutcome === 'indeterminate' || domainOutcome === 'unknown') {
        return DOMAIN_CLOSE[domainOutcome];
      }
      if (
        domainOutcome === 'pending_review' ||
        domainOutcome === 'waiting_authorization' ||
        domainOutcome === 'action_required' ||
        domainOutcome === 'mixed_attention'
      ) {
        return DOMAIN_CLOSE.mixed_attention;
      }
      return recap.status === 'canceled' ? DOMAIN_CLOSE.canceled : DOMAIN_CLOSE.failed;
    }
    return DOMAIN_CLOSE[domainOutcome];
  }

  if (recap.status === 'partial' || recap.status === 'failed' || recap.status === 'canceled') {
    const variants = CLOSE_VARIANTS[recap.status];
    const seed = `${recap.status}:${recap.total}:${subject ?? ''}`;
    const variant = variants[stableHash(seed) % variants.length];
    return { key: `messages.toolActivity.close.${variant}`, tone: CLOSE_TONE[recap.status] };
  }

  // A single successful action needs no recap — the agent's own reply already says it.
  // Anything with a snag (failed/canceled) or a stated focus is worth closing.
  const isTrivial = recap.total <= 1 && recap.failed === 0 && recap.canceled === 0 && !subject;
  if (isTrivial && recap.status === 'completed') return null;

  const variants = CLOSE_VARIANTS[recap.status];
  const seed = `${recap.status}:${recap.total}:${subject ?? ''}`;
  const variant = variants[stableHash(seed) % variants.length];

  return { key: `messages.toolActivity.close.${variant}`, tone: CLOSE_TONE[recap.status] };
};
