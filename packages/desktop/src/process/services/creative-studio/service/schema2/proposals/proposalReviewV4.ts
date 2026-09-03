/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioBoardProposalEffectV4,
  StudioBoardProposalReviewV4,
  StudioProposalDecisionRequestV4,
  StudioRendererBoardProposalV4,
} from '@/common/types/project/creativeStudioTypes';
import {
  hasExactInputKeysV4,
  isCanonicalInputTimestampV4,
  isPlainInputRecordV4,
  isSafeInputIdV4,
} from '../mutations/exactInputV4';
import { isStudioProposalIdV4, parseStudioProposalRecordV4 } from './proposalContractsV4';

export type StudioBoardProposalReviewInputV4 = {
  projectId: string;
  proposalId: string;
  authoringRevision: number;
  reviewedAt: string;
  proposal: unknown;
};

const REVIEW_INPUT_KEYS = new Set(['projectId', 'proposalId', 'authoringRevision', 'reviewedAt', 'proposal']);
const DECISION_REQUEST_KEYS = new Set(['projectId', 'proposalId']);

const isAuthoringRevision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1;

const snapshotReviewInput = (value: unknown): StudioBoardProposalReviewInputV4 | null => {
  if (
    !isPlainInputRecordV4(value) ||
    !hasExactInputKeysV4(value, REVIEW_INPUT_KEYS) ||
    !isSafeInputIdV4(value.projectId) ||
    !isStudioProposalIdV4(value.proposalId) ||
    !isAuthoringRevision(value.authoringRevision) ||
    !isCanonicalInputTimestampV4(value.reviewedAt)
  ) {
    return null;
  }
  return {
    projectId: value.projectId,
    proposalId: value.proposalId,
    authoringRevision: value.authoringRevision,
    reviewedAt: value.reviewedAt,
    proposal: value.proposal,
  };
};

export const deriveStudioBoardProposalEffectV4 = (
  proposal: Extract<ReturnType<typeof parseStudioProposalRecordV4>, { status: 'valid' }>['record']
): StudioBoardProposalEffectV4 => {
  const beats = proposal.payload.beats;
  return {
    kind: 'create_board',
    boardId: proposal.target.boardId,
    handle: proposal.payload.handle,
    beatCount: beats.length,
    shotCount: beats.reduce((total, beat) => total + beat.shots.length, 0),
    durationSeconds: beats.reduce(
      (total, beat) => total + beat.shots.reduce((beatTotal, shot) => beatTotal + shot.durationSeconds, 0),
      0
    ),
  };
};

const projectRendererBoardProposal = (
  proposal: Extract<ReturnType<typeof parseStudioProposalRecordV4>, { status: 'valid' }>['record']
): StudioRendererBoardProposalV4 => {
  const beats = proposal.payload.beats.map((beat) => ({
    title: beat.title,
    story: beat.story,
    targetSeconds: beat.targetSeconds,
    shots: beat.shots.map((shot) => ({
      shootingScript: shot.shootingScript,
      durationSeconds: shot.durationSeconds,
    })),
  }));
  const effect = deriveStudioBoardProposalEffectV4(proposal);
  return {
    proposalId: proposal.id,
    kind: 'board',
    status: 'proposed',
    boardId: proposal.target.boardId,
    handle: proposal.payload.handle,
    beats,
    beatCount: effect.beatCount,
    shotCount: effect.shotCount,
    durationSeconds: effect.durationSeconds,
    createdAt: proposal.createdAt,
    expiresAt: proposal.expiresAt,
  };
};

/**
 * Projects one immutable proposal for human review. Ordinary runtime revisions are deliberately
 * absent: only authoring revision can stale the decision, while malformed, future, or expired
 * records are unavailable.
 */
export const deriveStudioBoardProposalReviewV4 = (inputValue: unknown): StudioBoardProposalReviewV4 => {
  const input = snapshotReviewInput(inputValue);
  if (input === null) return { status: 'unavailable' };
  const parsed = parseStudioProposalRecordV4({
    projectId: input.projectId,
    proposalId: input.proposalId,
    value: input.proposal,
  });
  if (
    parsed.status !== 'valid' ||
    input.reviewedAt < parsed.record.createdAt ||
    input.reviewedAt >= parsed.record.expiresAt
  ) {
    return { status: 'unavailable' };
  }
  const proposal = projectRendererBoardProposal(parsed.record);
  return input.authoringRevision === parsed.record.baseAuthoringRevision
    ? { status: 'ready', proposal }
    : { status: 'stale_authoring', proposal };
};

/** Exact renderer-to-Main correlation parser shared by future accept and reject endpoints. */
export const snapshotStudioProposalDecisionRequestV4 = (value: unknown): StudioProposalDecisionRequestV4 | null => {
  if (
    !isPlainInputRecordV4(value) ||
    !hasExactInputKeysV4(value, DECISION_REQUEST_KEYS) ||
    !isSafeInputIdV4(value.projectId) ||
    !isStudioProposalIdV4(value.proposalId)
  ) {
    return null;
  }
  return { projectId: value.projectId, proposalId: value.proposalId };
};
