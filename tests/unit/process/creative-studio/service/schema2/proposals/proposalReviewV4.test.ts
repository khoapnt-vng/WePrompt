/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type {
  StudioBoardProposalEffectV4,
  StudioProposalDecisionResultV4,
  StudioRendererBoardProposalV4,
} from '@/common/types/project/creativeStudioTypes';
import {
  STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  deriveStudioProposalExpiresAtV4,
  deriveStudioProposalIdV4,
  type StudioProposalRecordV4,
} from '@/process/services/creative-studio/service/schema2/proposals/proposalContractsV4';
import {
  deriveStudioBoardProposalEffectV4,
  deriveStudioBoardProposalReviewV4,
  snapshotStudioProposalDecisionRequestV4,
} from '@/process/services/creative-studio/service/schema2/proposals/proposalReviewV4';

const projectId = 'project_1';
const commandId = 'command_1';
const proposalId = deriveStudioProposalIdV4(projectId, commandId);
const createdAt = '2026-09-02T01:00:00.000Z';
const expiresAt = deriveStudioProposalExpiresAtV4(createdAt);
const reviewedAt = '2026-09-03T01:00:00.000Z';

const proposalRecord = (): StudioProposalRecordV4 => ({
  schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  id: proposalId,
  projectId,
  status: 'pending',
  baseAuthoringRevision: 3,
  source: { kind: 'director_command', commandId, commandSha256: 'a'.repeat(64) },
  target: { kind: 'board', boardId: 'board_future' },
  issuedMemberIds: { beatIds: ['beat_1', 'beat_2'], shotIds: ['shot_1', 'shot_2', 'shot_3'] },
  payload: {
    kind: 'create_board',
    handle: 'harbour_board',
    beats: [
      {
        title: 'Arrival',
        story: 'A boat enters the harbour.',
        targetSeconds: 8,
        shots: [
          { shootingScript: 'Wide harbour at dawn.', durationSeconds: 4 },
          { shootingScript: 'The boat crosses frame.', durationSeconds: 4 },
        ],
      },
      {
        title: 'Landing',
        story: 'The passenger steps ashore.',
        targetSeconds: null,
        shots: [{ shootingScript: 'Shoes meet the wet pier.', durationSeconds: 5 }],
      },
    ],
  },
  createdAt,
  expiresAt,
  decidedAt: null,
});

const review = (overrides: Record<string, unknown> = {}) =>
  deriveStudioBoardProposalReviewV4({
    projectId,
    proposalId,
    authoringRevision: 3,
    reviewedAt,
    proposal: proposalRecord(),
    ...overrides,
  });

describe('schema-7 Board proposal review projection', () => {
  it('projects the complete future Board with deterministic count and duration facts', () => {
    const result = review();

    expect(result.status).toBe('ready');
    expect(result.status === 'ready' ? result.proposal : null).toEqual({
      proposalId,
      kind: 'board',
      status: 'proposed',
      boardId: 'board_future',
      handle: 'harbour_board',
      beats: proposalRecord().payload.beats,
      beatCount: 2,
      shotCount: 3,
      durationSeconds: 13,
      createdAt,
      expiresAt,
    } satisfies StudioRendererBoardProposalV4);
  });

  it('derives the concise human-visible Board effect from immutable authored facts', () => {
    expect(deriveStudioBoardProposalEffectV4(proposalRecord())).toEqual({
      kind: 'create_board',
      boardId: 'board_future',
      handle: 'harbour_board',
      beatCount: 2,
      shotCount: 3,
      durationSeconds: 13,
    } satisfies StudioBoardProposalEffectV4);
  });

  it('omits Director, issued-member, project, path, and hash authority from renderer output', () => {
    const result = review();
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(commandId);
    expect(serialized).not.toContain('beat_1');
    expect(serialized).not.toContain(projectId);
  });

  it('snapshots authored facts instead of retaining proposal-owned arrays', () => {
    const proposal = proposalRecord();
    const result = review({ proposal });
    proposal.payload.beats[0]!.shots[0]!.shootingScript = 'Changed after review';

    expect(result.status === 'ready' ? result.proposal.beats[0]!.shots[0]!.shootingScript : null).toBe(
      'Wide harbour at dawn.'
    );
  });

  it('stales only on authoring revision while retaining the safe review facts', () => {
    const result = review({ authoringRevision: 4 });

    expect(result.status).toBe('stale_authoring');
    expect(result.status === 'stale_authoring' ? result.proposal.boardId : null).toBe('board_future');
  });

  it('makes future and expired proposals unavailable at exact time boundaries', () => {
    expect(review({ reviewedAt: '2026-09-02T00:59:59.999Z' })).toEqual({ status: 'unavailable' });
    expect(review({ reviewedAt: expiresAt })).toEqual({ status: 'unavailable' });
  });

  it('fails closed for malformed records and non-exact review inputs', () => {
    const proposal = proposalRecord();
    expect(review({ proposal: { ...proposal, source: { ...proposal.source, commandId: 'other' } } })).toEqual({
      status: 'unavailable',
    });
    expect(review({ extra: true })).toEqual({ status: 'unavailable' });
    expect(deriveStudioBoardProposalReviewV4(new Proxy({}, {}))).toEqual({ status: 'unavailable' });
  });

  it('fails closed without invoking accessor-backed review fields', () => {
    let calls = 0;
    const input = {
      projectId,
      proposalId,
      authoringRevision: 3,
      reviewedAt,
      proposal: proposalRecord(),
    };
    Object.defineProperty(input, 'proposal', {
      enumerable: true,
      get() {
        calls += 1;
        return proposalRecord();
      },
    });

    expect(deriveStudioBoardProposalReviewV4(input)).toEqual({ status: 'unavailable' });
    expect(calls).toBe(0);
  });
});

describe('schema-7 renderer proposal decision contract', () => {
  it('accepts only the exact project and proposal correlation pair', () => {
    expect(snapshotStudioProposalDecisionRequestV4({ projectId, proposalId })).toEqual({ projectId, proposalId });
    expect(snapshotStudioProposalDecisionRequestV4({ projectId, proposalId, status: 'accepted' })).toBeNull();
    expect(snapshotStudioProposalDecisionRequestV4({ projectId: '../project', proposalId })).toBeNull();
  });

  it('rejects every safe-looking proposal identity outside the exact V4 domain', () => {
    for (const malformedProposalId of [
      `candidate_${'a'.repeat(64)}`,
      `proposal_${'A'.repeat(64)}`,
      `proposal_${'a'.repeat(63)}`,
      `proposal_${'a'.repeat(65)}`,
      'a'.repeat(256),
    ]) {
      expect(snapshotStudioProposalDecisionRequestV4({ projectId, proposalId: malformedProposalId })).toBeNull();
    }
  });

  it('defines the complete renderer-visible terminal result vocabulary', () => {
    type ResultByStatus = {
      [Status in StudioProposalDecisionResultV4['status']]: Extract<StudioProposalDecisionResultV4, { status: Status }>;
    };
    const effect = deriveStudioBoardProposalEffectV4(proposalRecord());
    const results: ResultByStatus = {
      accepted: { status: 'accepted', effect },
      already_accepted: { status: 'already_accepted', effect },
      rejected: { status: 'rejected' },
      expired: { status: 'expired' },
      unknown: { status: 'unknown' },
      stale_authoring: { status: 'stale_authoring' },
    };

    expect(Object.keys(results)).toEqual([
      'accepted',
      'already_accepted',
      'rejected',
      'expired',
      'unknown',
      'stale_authoring',
    ]);
  });
});
