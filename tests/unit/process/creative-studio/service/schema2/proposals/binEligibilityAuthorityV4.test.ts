/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { StudioCanvasBinSubjectV4, StudioProjectV4 } from '@/common/types/project/creativeStudioTypes';
import {
  deriveStudioBinEligibilityEvidenceV4,
  type StudioActiveProposalAuthorityV4,
  type StudioActivePhotoQuoteAuthorityV4,
} from '@/process/services/creative-studio/service/schema2/proposals/binEligibilityAuthorityV4';
import { liftStudioCanvasSubjectsToBinV4 } from '@/process/services/creative-studio/service/schema2/mutations/presentationV4';
import {
  STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  deriveStudioProposalExpiresAtV4,
  deriveStudioProposalIdV4,
  type StudioProposalRecordV4,
} from '@/process/services/creative-studio/service/schema2/proposals/proposalContractsV4';
import { makePhase6Project } from '../../../../../../fixtures/creative-studio/phase6Project';

const capturedAt = '2026-09-02T00:00:03.000Z';
const proposalCreatedAt = '2026-09-02T00:00:02.500Z';
const proposalReservedAt = proposalCreatedAt;
const quoteExpiresAt = '2026-09-02T01:00:00.000Z';
const proposalCommandId = 'command_future';
const proposalId = deriveStudioProposalIdV4('project_7', proposalCommandId);

const proposalRecord = (): StudioProposalRecordV4 => ({
  schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  id: proposalId,
  projectId: 'project_7',
  status: 'pending',
  baseAuthoringRevision: 2,
  source: { kind: 'director_command', commandId: proposalCommandId, commandSha256: 'a'.repeat(64) },
  target: { kind: 'board', boardId: 'board_future' },
  issuedMemberIds: { beatIds: ['beat_future'], shotIds: ['shot_future'] },
  payload: {
    kind: 'create_board',
    handle: 'future_board',
    beats: [
      {
        title: 'Arrival',
        story: 'A boat enters the harbour.',
        targetSeconds: 5,
        shots: [{ shootingScript: 'Wide harbour at dawn.', durationSeconds: 5 }],
      },
    ],
  },
  createdAt: proposalCreatedAt,
  expiresAt: deriveStudioProposalExpiresAtV4(proposalCreatedAt),
  decidedAt: null,
});

const activeProposal = (): StudioActiveProposalAuthorityV4 => {
  const record = proposalRecord();
  return {
    proposalId,
    current: {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
      proposalId,
      payloadSha256: createHash('sha256').update(JSON.stringify(record)).digest('hex'),
      admittedAt: proposalReservedAt,
      proposal: record,
    },
  };
};

const photoQuote = (overrides: Partial<StudioActivePhotoQuoteAuthorityV4> = {}): StudioActivePhotoQuoteAuthorityV4 => ({
  reservationId: 'reservation_1',
  projectId: 'project_7',
  quoteId: 'quote_1',
  quoteRevision: 1,
  targetPieceId: 'piece_photo_1',
  referencePieceIds: [],
  jobId: 'job_future_1',
  authorizationId: 'authorization_future_1',
  authorizationItemId: 'item_future_1',
  idempotencyKey: 'idempotency_future_1',
  expiresAt: quoteExpiresAt,
  mode: 'retry',
  ...overrides,
});

const addImportedPhotoPiece = (project: StudioProjectV4, suffix: number): string => {
  const pieceId = `piece_photo_${suffix}`;
  const assetId = `asset_photo_${suffix}`;
  project.pieceOrder.push(pieceId);
  project.pieces[pieceId] = {
    ...structuredClone(project.pieces.piece_photo_1!),
    id: pieceId,
    handle: `photo_${suffix}`,
    currentAssetId: assetId,
  };
  project.assets[assetId] = {
    ...structuredClone(project.assets.asset_photo_1!),
    id: assetId,
    pieceId,
    managedAsset: { collection: 'imports', fileName: `${assetId}.png` },
    sha256: String(suffix).repeat(64),
  };
  return pieceId;
};

const derive = (overrides: Partial<Parameters<typeof deriveStudioBinEligibilityEvidenceV4>[0]> = {}) => {
  const project = makePhase6Project();
  return deriveStudioBinEligibilityEvidenceV4({
    project,
    subjects: [
      { kind: 'piece', pieceId: 'piece_photo_1' },
      { kind: 'board', boardId: 'board_1' },
      { kind: 'board_shot', boardId: 'board_1', shotId: 'shot_2' },
      { kind: 'assembly', assemblyId: 'assembly_1' },
    ],
    entryIds: ['bin_piece', 'bin_board', 'bin_shot', 'bin_assembly'],
    activeProposal: null,
    activePhotoQuotes: [],
    capturedAt,
    ...overrides,
  });
};

describe('schema-7 Main Bin eligibility authority', () => {
  it('derives one ordered clear row per exact subject and snapshots the identities', () => {
    const subjects: StudioCanvasBinSubjectV4[] = [
      { kind: 'piece', pieceId: 'piece_photo_1' },
      { kind: 'board', boardId: 'board_1' },
      { kind: 'board_shot', boardId: 'board_1', shotId: 'shot_2' },
      { kind: 'assembly', assemblyId: 'assembly_1' },
    ];
    const result = derive({ subjects });

    expect(result).toEqual({
      status: 'valid',
      evidence: {
        projectId: 'project_7',
        projectRevision: 2,
        entryIds: ['bin_piece', 'bin_board', 'bin_shot', 'bin_assembly'],
        decisions: subjects.map((subject) => ({ subject, state: 'clear' })),
        capturedAt,
      },
    });
    if (result.status !== 'valid') return;
    expect(result.evidence.decisions[0]!.subject).not.toBe(subjects[0]);
    subjects[0] = { kind: 'piece', pieceId: 'piece_changed' };
    expect(result.evidence.decisions[0]!.subject).toEqual({ kind: 'piece', pieceId: 'piece_photo_1' });
    const entryIds = ['bin_snapshot'];
    const entryResult = derive({ subjects: [{ kind: 'piece', pieceId: 'piece_photo_1' }], entryIds });
    expect(entryResult.status).toBe('valid');
    entryIds[0] = 'bin_changed';
    expect(entryResult.status === 'valid' ? entryResult.evidence.entryIds : []).toEqual(['bin_snapshot']);
  });

  it('marks only the Board subtree named by the correlated active proposal slot as proposed', () => {
    const project = makePhase6Project();
    project.revision += 1;
    const result = deriveStudioBinEligibilityEvidenceV4({
      project,
      subjects: [
        { kind: 'board', boardId: 'board_future' },
        { kind: 'board', boardId: 'board_1' },
        { kind: 'board_shot', boardId: 'board_future', shotId: 'shot_future' },
      ],
      entryIds: ['bin_future_board', 'bin_current_board', 'bin_future_shot'],
      activeProposal: activeProposal(),
      activePhotoQuotes: [],
      capturedAt,
    });

    expect(result).toEqual({
      status: 'valid',
      evidence: {
        projectId: 'project_7',
        projectRevision: 3,
        entryIds: ['bin_future_board', 'bin_current_board', 'bin_future_shot'],
        decisions: [
          { subject: { kind: 'board', boardId: 'board_future' }, state: 'proposed' },
          { subject: { kind: 'board', boardId: 'board_1' }, state: 'clear' },
          {
            subject: { kind: 'board_shot', boardId: 'board_future', shotId: 'shot_future' },
            state: 'proposed',
          },
        ],
        capturedAt,
      },
    });
  });

  it('marks exact Piece targets with active prepared-photo quotes as needs budget', () => {
    const result = derive({
      subjects: [
        { kind: 'piece', pieceId: 'piece_photo_1' },
        { kind: 'piece', pieceId: 'piece_future' },
        { kind: 'board', boardId: 'board_1' },
      ],
      entryIds: ['bin_retry_piece', 'bin_future_piece', 'bin_board'],
      activePhotoQuotes: [
        photoQuote(),
        photoQuote({
          reservationId: 'reservation_2',
          quoteId: 'quote_2',
          targetPieceId: 'piece_future',
          jobId: 'job_future_2',
          authorizationId: 'authorization_future_2',
          authorizationItemId: 'item_future_2',
          idempotencyKey: 'idempotency_future_2',
          mode: 'create',
        }),
      ],
    });

    expect(result.status).toBe('valid');
    if (result.status !== 'valid') return;
    expect(result.evidence.decisions).toEqual([
      { subject: { kind: 'piece', pieceId: 'piece_photo_1' }, state: 'needs_budget' },
      { subject: { kind: 'piece', pieceId: 'piece_future' }, state: 'needs_budget' },
      { subject: { kind: 'board', boardId: 'board_1' }, state: 'clear' },
    ]);
  });

  it.each([
    { mode: 'create' as const, targetPieceId: 'piece_future' },
    { mode: 'retry' as const, targetPieceId: 'piece_photo_1' },
  ])('marks a $mode quote conditioning reference as quote-pending while unrelated Pieces stay clear', (quote) => {
    const project = makePhase6Project();
    const referencePieceId = addImportedPhotoPiece(project, 2);
    const unrelatedPieceId = addImportedPhotoPiece(project, 3);
    const authority = photoQuote({ ...quote, referencePieceIds: [referencePieceId] });
    const subjects: StudioCanvasBinSubjectV4[] = [
      { kind: 'piece', pieceId: referencePieceId },
      { kind: 'piece', pieceId: unrelatedPieceId },
    ];
    const result = deriveStudioBinEligibilityEvidenceV4({
      project,
      subjects,
      entryIds: ['bin_reference', 'bin_unrelated'],
      activeProposal: null,
      activePhotoQuotes: [authority],
      capturedAt,
    });

    expect(result.status).toBe('valid');
    if (result.status !== 'valid') return;
    expect(result.evidence.decisions).toEqual([
      { subject: subjects[0], state: 'needs_budget' },
      { subject: subjects[1], state: 'clear' },
    ]);

    const referenceOnly = deriveStudioBinEligibilityEvidenceV4({
      project,
      subjects: [subjects[0]],
      entryIds: ['bin_reference'],
      activeProposal: null,
      activePhotoQuotes: [authority],
      capturedAt,
    });
    expect(referenceOnly.status).toBe('valid');
    if (referenceOnly.status !== 'valid') return;
    expect(
      liftStudioCanvasSubjectsToBinV4(
        project,
        { projectId: project.id, expectedRevision: project.revision, subjects: [subjects[0]] },
        referenceOnly.evidence
      )
    ).toEqual({ status: 'refused', reason: 'quote_pending' });
    expect(project.bin).toEqual([]);
  });

  it('fails closed for an uncorrelated, future, or chronologically impossible proposal authority', () => {
    const wrongSlot = activeProposal();
    wrongSlot.current.proposalId = 'proposal_other';
    expect(derive({ activeProposal: wrongSlot })).toEqual({ status: 'invalid_authority' });

    const futureRevision = activeProposal();
    futureRevision.current.proposal.baseAuthoringRevision = 3;
    expect(derive({ activeProposal: futureRevision })).toEqual({ status: 'invalid_authority' });

    const lateSlot = activeProposal();
    lateSlot.current.admittedAt = capturedAt;
    expect(derive({ activeProposal: lateSlot })).toEqual({ status: 'invalid_authority' });

    const preProjectSlot = activeProposal();
    preProjectSlot.current.admittedAt = '2026-09-01T23:59:59.999Z';
    expect(derive({ activeProposal: preProjectSlot })).toEqual({ status: 'invalid_authority' });

    const futureRecord = activeProposal();
    futureRecord.current.proposal.createdAt = quoteExpiresAt;
    expect(derive({ activeProposal: futureRecord })).toEqual({ status: 'invalid_authority' });

    const expired = activeProposal();
    expired.current.proposal.createdAt = '2026-08-25T00:00:00.000Z';
    expired.current.proposal.expiresAt = deriveStudioProposalExpiresAtV4(expired.current.proposal.createdAt);
    expired.current.admittedAt = expired.current.proposal.createdAt;
    expect(derive({ activeProposal: expired })).toEqual({ status: 'invalid_authority' });
  });

  it('fails closed for foreign, expired, malformed, or duplicate active quote targets', () => {
    expect(derive({ activePhotoQuotes: [photoQuote({ projectId: 'project_other' })] })).toEqual({
      status: 'invalid_authority',
    });
    expect(derive({ activePhotoQuotes: [photoQuote({ expiresAt: capturedAt })] })).toEqual({
      status: 'invalid_authority',
    });
    expect(derive({ activePhotoQuotes: [photoQuote({ targetPieceId: 'piece:unsafe' })] })).toEqual({
      status: 'invalid_authority',
    });
    expect(derive({ activePhotoQuotes: [photoQuote({ referencePieceIds: ['piece_missing'] })] })).toEqual({
      status: 'invalid_authority',
    });
    expect(
      derive({ activePhotoQuotes: [photoQuote({ referencePieceIds: ['piece_photo_1', 'piece_photo_1'] })] })
    ).toEqual({ status: 'invalid_authority' });
    expect(
      derive({
        activePhotoQuotes: [photoQuote({ referencePieceIds: ['piece_photo_2', 'piece_photo_3', 'piece_photo_4'] })],
      })
    ).toEqual({ status: 'invalid_authority' });
    expect(derive({ activePhotoQuotes: [photoQuote({ referencePieceIds: ['piece_photo_1'] })] })).toEqual({
      status: 'invalid_authority',
    });
    expect(
      derive({
        activePhotoQuotes: [photoQuote(), photoQuote({ reservationId: 'reservation_2', quoteId: 'quote_2' })],
      })
    ).toEqual({ status: 'invalid_authority' });
  });

  it('rejects active quote authority that targets or conditions on an already binned Piece', () => {
    const project = makePhase6Project();
    const binnedPieceId = addImportedPhotoPiece(project, 2);
    const clearEvidence = deriveStudioBinEligibilityEvidenceV4({
      project,
      subjects: [{ kind: 'piece', pieceId: binnedPieceId }],
      entryIds: ['bin_existing'],
      activeProposal: null,
      activePhotoQuotes: [],
      capturedAt,
    });
    expect(clearEvidence.status).toBe('valid');
    if (clearEvidence.status !== 'valid') return;
    const lifted = liftStudioCanvasSubjectsToBinV4(
      project,
      {
        projectId: project.id,
        expectedRevision: project.revision,
        subjects: [{ kind: 'piece', pieceId: binnedPieceId }],
      },
      clearEvidence.evidence
    );
    expect(lifted.status).toBe('applied');
    if (lifted.status !== 'applied') return;

    const base = {
      project: lifted.project,
      subjects: [{ kind: 'board', boardId: 'board_1' }],
      entryIds: ['bin_board'],
      activeProposal: null,
      capturedAt,
    };
    expect(
      deriveStudioBinEligibilityEvidenceV4({
        ...base,
        activePhotoQuotes: [photoQuote({ mode: 'retry', targetPieceId: binnedPieceId })],
      })
    ).toEqual({ status: 'invalid_authority' });
    expect(
      deriveStudioBinEligibilityEvidenceV4({
        ...base,
        activePhotoQuotes: [
          photoQuote({ mode: 'create', targetPieceId: 'piece_future', referencePieceIds: [binnedPieceId] }),
        ],
      })
    ).toEqual({ status: 'invalid_authority' });
  });

  it('binds evidence to a valid current project snapshot, unique subjects, and a current timestamp', () => {
    const invalidProject = makePhase6Project();
    invalidProject.schemaVersion = 6 as typeof invalidProject.schemaVersion;
    expect(derive({ project: invalidProject })).toEqual({ status: 'invalid_authority' });
    expect(derive({ capturedAt: 'not-a-time' })).toEqual({ status: 'invalid_authority' });
    expect(derive({ capturedAt: '2026-09-01T23:59:59.000Z' })).toEqual({ status: 'invalid_authority' });
    expect(
      derive({
        subjects: [
          { kind: 'piece', pieceId: 'piece_photo_1' },
          { kind: 'piece', pieceId: 'piece_photo_1' },
        ],
      })
    ).toEqual({ status: 'invalid_authority' });
    expect(derive({ subjects: [{ kind: 'piece', pieceId: 'piece:unsafe' }] as StudioCanvasBinSubjectV4[] })).toEqual({
      status: 'invalid_authority',
    });
  });

  it('does not invoke subject accessors or accept extra keys from a renderer-shaped request', () => {
    let getterCalls = 0;
    const accessorSubject = { pieceId: 'piece_photo_1' };
    Object.defineProperty(accessorSubject, 'kind', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'piece';
      },
    });

    expect(derive({ subjects: [accessorSubject] })).toEqual({ status: 'invalid_authority' });
    expect(getterCalls).toBe(0);
    expect(derive({ subjects: [{ kind: 'piece', pieceId: 'piece_photo_1', state: 'clear' }] })).toEqual({
      status: 'invalid_authority',
    });
    expect(derive({ subjects: new Proxy([], {}) })).toEqual({ status: 'invalid_authority' });
  });

  it('exact-parses proposal and quote authorities without invoking caller code', () => {
    let getterCalls = 0;
    const proposal = activeProposal() as unknown as Record<string, unknown>;
    Object.defineProperty(proposal, 'record', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return proposalRecord();
      },
    });
    expect(derive({ activeProposal: proposal as StudioActiveProposalAuthorityV4 })).toEqual({
      status: 'invalid_authority',
    });

    const quote = photoQuote() as unknown as Record<string, unknown>;
    Object.defineProperty(quote, 'mode', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'retry';
      },
    });
    expect(derive({ activePhotoQuotes: [quote as StudioActivePhotoQuoteAuthorityV4] })).toEqual({
      status: 'invalid_authority',
    });
    expect(derive({ activePhotoQuotes: [null] as unknown as StudioActivePhotoQuoteAuthorityV4[] })).toEqual({
      status: 'invalid_authority',
    });
    expect(derive({ activePhotoQuotes: new Proxy([], {}) })).toEqual({ status: 'invalid_authority' });
    expect(derive({ activeProposal: { ...activeProposal(), extra: true } as StudioActiveProposalAuthorityV4 })).toEqual(
      { status: 'invalid_authority' }
    );
    expect(getterCalls).toBe(0);
  });

  it('reserves every proposal and quote identity before accepting issued Bin ids', () => {
    const subject = [{ kind: 'piece' as const, pieceId: 'piece_photo_1' }];
    for (const entryId of ['project_7', 'piece_photo_1', 'asset_photo_1']) {
      expect(derive({ subjects: subject, entryIds: [entryId] }), entryId).toEqual({ status: 'invalid_authority' });
    }

    for (const entryId of [proposalId, 'board_future', 'beat_future', 'shot_future']) {
      expect(derive({ subjects: subject, entryIds: [entryId], activeProposal: activeProposal() }), entryId).toEqual({
        status: 'invalid_authority',
      });
    }

    for (const entryId of [
      'reservation_1',
      'quote_1',
      'job_future_1',
      'authorization_future_1',
      'item_future_1',
      'idempotency_future_1',
    ]) {
      expect(derive({ subjects: subject, entryIds: [entryId], activePhotoQuotes: [photoQuote()] }), entryId).toEqual({
        status: 'invalid_authority',
      });
    }

    expect(
      derive({
        subjects: subject,
        entryIds: ['bin_1'],
        activeProposal: activeProposal(),
        activePhotoQuotes: [photoQuote({ jobId: proposalId })],
      })
    ).toEqual({ status: 'invalid_authority' });
  });

  it('composes derived Main authority directly with the Bin mutation and preserves pending quotes', () => {
    const clearProject = makePhase6Project();
    clearProject.assemblyOrder = [];
    clearProject.assemblies = {};
    const subject = { kind: 'piece' as const, pieceId: 'piece_photo_1' };
    const request = {
      projectId: clearProject.id,
      expectedRevision: clearProject.revision,
      subjects: [subject],
    };
    const clearEvidence = deriveStudioBinEligibilityEvidenceV4({
      project: clearProject,
      subjects: [subject],
      entryIds: ['bin_composed_clear'],
      activeProposal: null,
      activePhotoQuotes: [],
      capturedAt,
    });
    expect(clearEvidence.status).toBe('valid');
    if (clearEvidence.status !== 'valid') return;

    const applied = liftStudioCanvasSubjectsToBinV4(clearProject, request, clearEvidence.evidence);
    expect(applied.status).toBe('applied');
    if (applied.status !== 'applied') return;
    expect(applied.project.bin).toEqual([
      { id: 'bin_composed_clear', subject, reason: 'lifted', liftedAt: capturedAt },
    ]);

    const blockedProject = makePhase6Project();
    blockedProject.assemblyOrder = [];
    blockedProject.assemblies = {};
    const blockedEvidence = deriveStudioBinEligibilityEvidenceV4({
      project: blockedProject,
      subjects: [subject],
      entryIds: ['bin_composed_blocked'],
      activeProposal: null,
      activePhotoQuotes: [photoQuote()],
      capturedAt,
    });
    expect(blockedEvidence.status).toBe('valid');
    if (blockedEvidence.status !== 'valid') return;
    expect(liftStudioCanvasSubjectsToBinV4(blockedProject, request, blockedEvidence.evidence)).toEqual({
      status: 'refused',
      reason: 'quote_pending',
    });
    expect(blockedProject.bin).toEqual([]);
  });

  it('rejects an inexact derivation envelope before reading its properties', () => {
    const base = {
      project: makePhase6Project(),
      subjects: [{ kind: 'piece', pieceId: 'piece_photo_1' }],
      entryIds: ['bin_1'],
      activeProposal: null,
      activePhotoQuotes: [],
      capturedAt,
    };
    expect(deriveStudioBinEligibilityEvidenceV4({ ...base, extra: true } as never)).toEqual({
      status: 'invalid_authority',
    });
    const withSymbol = { ...base } as Record<PropertyKey, unknown>;
    withSymbol[Symbol('extra')] = true;
    expect(deriveStudioBinEligibilityEvidenceV4(withSymbol as never)).toEqual({ status: 'invalid_authority' });

    let getterCalls = 0;
    const accessor = { ...base } as Record<string, unknown>;
    Object.defineProperty(accessor, 'project', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return makePhase6Project();
      },
    });
    expect(deriveStudioBinEligibilityEvidenceV4(accessor as never)).toEqual({ status: 'invalid_authority' });
    expect(getterCalls).toBe(0);
  });
});
