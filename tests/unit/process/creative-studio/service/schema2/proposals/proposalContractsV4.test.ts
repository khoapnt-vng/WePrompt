/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { STUDIO_MAX_SHOOTING_SCRIPT_LENGTH } from '@/common/types/project/creativeStudioTypes';
import {
  STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4,
  STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT_V4,
  STUDIO_PROPOSAL_PENDING_TTL_MS_V4,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  STUDIO_PROPOSAL_TERMINAL_TRANSACTION_MAX_BYTES_V4,
  STUDIO_PROPOSAL_TERMINAL_TRANSACTION_SCHEMA_VERSION_V4,
  admitStudioProposalRecordV4,
  deriveStudioProposalExpiresAtV4,
  deriveStudioProposalIdV4,
  isStudioProposalIdV4,
  parseStudioProposalCommitAttributionV4,
  parseStudioProposalCurrentV4,
  parseStudioProposalDecidedEnvelopeV4,
  parseStudioProposalDecisionV4,
  parseStudioProposalHistoryV4,
  parseStudioProposalRecordV4,
  parseStudioProposalTerminalTransactionV4,
  type StudioProposalCommitAttributionV4,
  type StudioProposalDecisionV4,
  type StudioProposalRecordV4,
  type StudioProposalTerminalTransactionV4,
} from '@/process/services/creative-studio/service/schema2/proposals/proposalContractsV4';

const createdAt = '2026-09-02T01:00:00.000Z';
const decidedAt = '2026-09-02T01:01:00.000Z';
const projectId = 'project_1';
const commandId = 'command_1';
const proposalId = deriveStudioProposalIdV4(projectId, commandId);
const expiresAt = deriveStudioProposalExpiresAtV4(createdAt);
const shaB = 'b'.repeat(64);
const shaC = 'c'.repeat(64);

const sha256Utf8 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const proposalRecord = (): StudioProposalRecordV4 => ({
  schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  id: proposalId,
  projectId,
  status: 'pending',
  baseAuthoringRevision: 3,
  source: { kind: 'director_command', commandId, commandSha256: sha256Utf8(commandId) },
  target: { kind: 'board', boardId: 'board_1' },
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

const proposalDecision = (): StudioProposalDecisionV4 => ({
  schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  proposalId,
  projectId,
  status: 'accepted',
  decidedAt,
});

const proposalBytes = (proposal: unknown = proposalRecord()): string => JSON.stringify(proposal);

const proposalAttribution = (bytes = proposalBytes()): StudioProposalCommitAttributionV4 => ({
  schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  kind: 'create_board',
  proposalId,
  projectId,
  beforeRevision: 7,
  afterRevision: 8,
  beforeAuthoringRevision: 3,
  afterAuthoringRevision: 4,
  target: { kind: 'board', boardId: 'board_1' },
  createdBeatIds: ['beat_1', 'beat_2'],
  createdShotIds: ['shot_1', 'shot_2', 'shot_3'],
  proposalSha256: sha256Utf8(bytes),
  beforeManifestSha256: shaB,
  afterManifestSha256: shaC,
  committedAt: decidedAt,
});

const proposalCurrent = () => ({
  schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  proposalId,
  payloadSha256: sha256Utf8(proposalBytes()),
  admittedAt: createdAt,
  proposal: proposalRecord(),
});

const proposalHistory = () => ({
  schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  entries: [],
});

const proposalAcceptTransaction = (
  bytes = proposalBytes()
): Extract<StudioProposalTerminalTransactionV4, { kind: 'accept_board' }> => {
  const commitBytes = JSON.stringify(proposalAttribution(bytes));
  const decisionBytes = JSON.stringify(proposalDecision());
  return {
    schemaVersion: STUDIO_PROPOSAL_TERMINAL_TRANSACTION_SCHEMA_VERSION_V4,
    kind: 'accept_board',
    proposalId,
    projectId,
    proposalSha256: sha256Utf8(bytes),
    commitBytes,
    decisionBytes,
  };
};

const proposalSettlementTransaction = (
  status: 'rejected' | 'expired',
  bytes = proposalBytes()
): Extract<StudioProposalTerminalTransactionV4, { kind: 'reject_board' | 'expire_board' }> => ({
  schemaVersion: STUDIO_PROPOSAL_TERMINAL_TRANSACTION_SCHEMA_VERSION_V4,
  kind: status === 'rejected' ? 'reject_board' : 'expire_board',
  proposalId,
  projectId,
  proposalSha256: sha256Utf8(bytes),
  decisionBytes: JSON.stringify({
    ...proposalDecision(),
    status,
    decidedAt: status === 'expired' ? expiresAt : decidedAt,
  }),
});

const proposalDecidedEnvelope = () => ({
  schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  proposal: proposalRecord(),
  payloadSha256: sha256Utf8(proposalBytes()),
  terminalTransaction: proposalAcceptTransaction(),
});

const parseRecord = (value: unknown) => parseStudioProposalRecordV4({ projectId, proposalId, value });

const admitRecord = (value: unknown) => admitStudioProposalRecordV4({ projectId, proposalId, value });

const parseDecision = (value: unknown) => parseStudioProposalDecisionV4({ projectId, proposalId, value });

const parseAttribution = (value: unknown, bytes = proposalBytes()) =>
  parseStudioProposalCommitAttributionV4({
    projectId,
    proposalId,
    proposalBytes: bytes,
    value,
  });

const parseTerminalTransaction = (value: unknown, bytes = proposalBytes()) =>
  parseStudioProposalTerminalTransactionV4({
    projectId,
    proposalId,
    proposalBytes: bytes,
    value,
  });

const expectInvalid = (result: { status: string }): void => expect(result).toEqual({ status: 'invalid' });

const proposalRecordWithSerializedByteLength = (targetByteLength: number): StudioProposalRecordV4 => {
  const record = proposalRecord();
  record.payload.beats = [
    {
      title: 'Boundary record',
      story: '',
      targetSeconds: null,
      shots: Array.from({ length: 11 }, (_, index) => ({
        shootingScript: index < 10 ? 'x'.repeat(STUDIO_MAX_SHOOTING_SCRIPT_LENGTH) : 'x',
        durationSeconds: 4,
      })),
    },
  ];
  record.issuedMemberIds = {
    beatIds: ['beat_1'],
    shotIds: Array.from({ length: 11 }, (_, index) => `shot_${index + 1}`),
  };
  const initialByteLength = Buffer.byteLength(JSON.stringify(record), 'utf8');
  const finalScriptLength = 1 + targetByteLength - initialByteLength;
  expect(finalScriptLength).toBeGreaterThan(0);
  expect(finalScriptLength).toBeLessThanOrEqual(STUDIO_MAX_SHOOTING_SCRIPT_LENGTH);
  record.payload.beats[0]!.shots[10]!.shootingScript = 'x'.repeat(finalScriptLength);
  expect(Buffer.byteLength(JSON.stringify(record), 'utf8')).toBe(targetByteLength);
  return record;
};

describe('schema-7 Director proposal sidecar contracts', () => {
  it('pins the proposal envelope to exactly 262144 UTF-8 bytes', () => {
    expect(STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4).toBe(262_144);
  });

  it('derives one domain-separated proposal identity from project and Director command authority', () => {
    expect(proposalId).toBe('proposal_9feb20566548ae2e70ff20912476eb899d9ec79c2a0024cb2b1a45c8482133c0');
    expect(deriveStudioProposalIdV4(projectId, 'command_2')).not.toBe(proposalId);
    expect(() => deriveStudioProposalIdV4('../project', commandId)).toThrow(TypeError);
  });

  it('recognizes only the exact proposal prefix followed by 64 lowercase hexadecimal characters', () => {
    expect(isStudioProposalIdV4(`proposal_${'a'.repeat(64)}`)).toBe(true);
    for (const malformedProposalId of [
      `candidate_${'a'.repeat(64)}`,
      `proposal_${'A'.repeat(64)}`,
      `proposal_${'a'.repeat(63)}`,
      `proposal_${'a'.repeat(65)}`,
      'a'.repeat(256),
    ]) {
      expect(isStudioProposalIdV4(malformedProposalId)).toBe(false);
    }
  });

  it('pins pending proposal expiry to the shared seven-day retention interval', () => {
    expect(STUDIO_PROPOSAL_PENDING_TTL_MS_V4).toBe(604_800_000);
    expect(expiresAt).toBe('2026-09-09T01:00:00.000Z');
    expect(() => deriveStudioProposalExpiresAtV4('not-a-timestamp')).toThrow(TypeError);
    expect(() => deriveStudioProposalExpiresAtV4('9999-12-31T23:59:59.999Z')).toThrow(TypeError);
  });

  it('admits an exact-boundary canonical proposal and returns the exact bytes to persist', () => {
    const input = proposalRecordWithSerializedByteLength(STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4);
    const admitted = admitRecord(input);

    expect(admitted.status).toBe('valid');
    if (admitted.status !== 'valid') return;
    expect(admitted.byteLength).toBe(262_144);
    expect(admitted.proposalBytes === JSON.stringify(input)).toBe(true);
    expect(admitted.record).not.toBe(input);
    expect(Object.getPrototypeOf(admitted.record)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(admitted.record.payload)).toBe(Object.prototype);
  });

  it('classifies a semantically valid proposal one byte over the envelope before sidecar I/O', () => {
    const input = proposalRecordWithSerializedByteLength(STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4 + 1);

    expect(admitRecord(input)).toEqual({
      status: 'proposal_too_large',
      record: input,
      proposalBytes: JSON.stringify(input),
      byteLength: 262_145,
      maxBytes: 262_144,
    });
    // Persisted bytes do not become a recoverable admission refusal.
    expectInvalid(parseRecord(input));
  });

  it('measures canonical serialized proposals in UTF-8 bytes rather than JavaScript code units', () => {
    const input = proposalRecord();
    input.payload.beats[0]!.story = '水面'.repeat(17);
    const admitted = admitRecord(input);

    expect(admitted.status).toBe('valid');
    if (admitted.status !== 'valid') return;
    expect(admitted.byteLength).toBe(Buffer.byteLength(admitted.proposalBytes, 'utf8'));
    expect(admitted.byteLength).toBeGreaterThan(admitted.proposalBytes.length);
    expect(admitted.proposalBytes).toBe(JSON.stringify(admitted.record));
  });

  it('fails closed on malformed, accessor, proxy, revoked-proxy, and cyclic admission inputs', () => {
    const semanticallyInvalidOversize = proposalRecordWithSerializedByteLength(STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4 + 1);
    semanticallyInvalidOversize.payload.beats[0]!.shots[0]!.durationSeconds = 0;
    expectInvalid(admitRecord(semanticallyInvalidOversize));

    let getterCalls = 0;
    const accessor = proposalRecord() as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, 'payload', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return proposalRecord().payload;
      },
    });
    expectInvalid(admitRecord(accessor));

    let proxyTrapCalls = 0;
    const proxy = new Proxy(proposalRecord(), {
      ownKeys: () => {
        proxyTrapCalls += 1;
        return [];
      },
    });
    expectInvalid(admitRecord(proxy));

    const revocable = Proxy.revocable(proposalRecord(), {});
    revocable.revoke();
    expect(() => admitRecord(revocable.proxy)).not.toThrow();
    expectInvalid(admitRecord(revocable.proxy));

    const cyclic = proposalRecord();
    cyclic.payload.beats[0]!.shots[0]!.shootingScript = cyclic as unknown as string;
    expect(() => admitRecord(cyclic)).not.toThrow();
    expectInvalid(admitRecord(cyclic));
    expect(getterCalls).toBe(0);
    expect(proxyTrapCalls).toBe(0);
  });

  it('keeps the proposal protocol discriminator independent from project schema 7', () => {
    expect(STUDIO_PROPOSAL_SCHEMA_VERSION_V4).not.toBe(7);
    expect(admitRecord({ ...proposalRecord(), schemaVersion: 7 })).toEqual({
      status: 'unsupported_prototype_schema',
    });
  });

  it('accepts and snapshots one exact create-board proposal with Main-issued target and member ids', () => {
    const input = proposalRecord();
    const parsed = parseRecord(input);

    expect(parsed).toEqual({ status: 'valid', record: input });
    expect(STUDIO_PROPOSAL_MAX_PENDING_PER_PROJECT_V4).toBe(1);
    if (parsed.status !== 'valid') return;
    expect(parsed.record).not.toBe(input);
    expect(parsed.record.target).not.toBe(input.target);
    expect(parsed.record.payload.beats).not.toBe(input.payload.beats);

    input.payload.beats[0]!.title = 'Mutated after parsing';
    input.issuedMemberIds.shotIds[0] = 'shot_changed';
    expect(parsed.record.payload.beats[0]!.title).toBe('Arrival');
    expect(parsed.record.issuedMemberIds.shotIds[0]).toBe('shot_1');
  });

  it('accepts exact terminal decisions, project slots, and correlated free commit attribution', () => {
    expect(parseDecision(proposalDecision())).toEqual({ status: 'valid', record: proposalDecision() });
    expect(parseAttribution(proposalAttribution())).toEqual({
      status: 'valid',
      record: proposalAttribution(),
    });

    for (const status of ['accepted', 'rejected', 'expired'] as const) {
      expect(parseDecision({ ...proposalDecision(), status }).status).toBe('valid');
    }
  });

  it('classifies every future proposal-family discriminator as unsupported', () => {
    const futureVersion = STUDIO_PROPOSAL_SCHEMA_VERSION_V4 + 1;
    const cases: Array<{ parse: (value: unknown) => { status: string }; value: Record<string, unknown> }> = [
      { parse: admitRecord, value: proposalRecord() },
      { parse: parseRecord, value: proposalRecord() },
      { parse: parseDecision, value: proposalDecision() },
      { parse: parseAttribution, value: proposalAttribution() },
      { parse: (value) => parseStudioProposalCurrentV4({ projectId, value }), value: proposalCurrent() },
      { parse: parseStudioProposalHistoryV4, value: proposalHistory() },
      {
        parse: (value) => parseStudioProposalDecidedEnvelopeV4({ projectId, proposalId, value }),
        value: proposalDecidedEnvelope(),
      },
    ];

    for (const { parse, value } of cases) {
      expect(parse({ ...value, schemaVersion: futureVersion })).toEqual({
        status: 'unsupported_prototype_schema',
      });
    }
  });

  it('rejects malformed proposal protocol discriminators', () => {
    for (const schemaVersion of [0, -1, 1.5, '7', null]) {
      expectInvalid(parseRecord({ ...proposalRecord(), schemaVersion }));
      expectInvalid(parseDecision({ ...proposalDecision(), schemaVersion }));
      expectInvalid(parseAttribution({ ...proposalAttribution(), schemaVersion }));
    }
  });

  it('rejects extra keys at every proposal boundary', () => {
    const record = proposalRecord();
    expectInvalid(parseRecord({ ...record, authorizationId: null }));
    expectInvalid(parseRecord({ ...record, source: { ...record.source, retry: false } }));
    expectInvalid(parseRecord({ ...record, target: { ...record.target, representative: true } }));
    expectInvalid(parseRecord({ ...record, issuedMemberIds: { ...record.issuedMemberIds, boardIds: ['board_1'] } }));
    expectInvalid(parseRecord({ ...record, payload: { ...record.payload, quote: null } }));
    expectInvalid(
      parseRecord({
        ...record,
        payload: {
          ...record.payload,
          beats: [{ ...record.payload.beats[0]!, label: 'extra' }, record.payload.beats[1]!],
        },
      })
    );
    expectInvalid(parseDecision({ ...proposalDecision(), reason: 'looks good' }));
    expectInvalid(parseAttribution({ ...proposalAttribution(), authorizationId: 'authorization_1' }));
  });

  it('rejects accessors without invoking them, including nested Board array entries', () => {
    let getterCalls = 0;
    const accessorRecord = proposalRecord() as unknown as Record<string, unknown>;
    Object.defineProperty(accessorRecord, 'payload', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return proposalRecord().payload;
      },
    });
    expectInvalid(parseRecord(accessorRecord));

    const nestedRecord = proposalRecord();
    const beats = [...nestedRecord.payload.beats];
    Object.defineProperty(beats, '0', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return nestedRecord.payload.beats[0];
      },
    });
    expectInvalid(parseRecord({ ...nestedRecord, payload: { ...nestedRecord.payload, beats } }));

    for (const [parse, value] of [
      [parseDecision, proposalDecision()],
      [parseAttribution, proposalAttribution()],
    ] as const) {
      const accessor = { ...value } as Record<string, unknown>;
      Object.defineProperty(accessor, 'schemaVersion', {
        enumerable: true,
        get: () => {
          getterCalls += 1;
          return STUDIO_PROPOSAL_SCHEMA_VERSION_V4;
        },
      });
      expectInvalid(parse(accessor));
    }
    expect(getterCalls).toBe(0);
  });

  it('rejects live and revoked proxies without executing their traps', () => {
    let trapCalls = 0;
    const proxy = new Proxy(proposalRecord(), {
      ownKeys: () => {
        trapCalls += 1;
        return [];
      },
    });
    expectInvalid(parseRecord(proxy));

    const nestedProxy = new Proxy(proposalRecord().payload, {
      get: (target, key, receiver) => {
        trapCalls += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    expectInvalid(parseRecord({ ...proposalRecord(), payload: nestedProxy }));

    const revocable = Proxy.revocable(proposalDecision(), {});
    revocable.revoke();
    expect(() => parseDecision(revocable.proxy)).not.toThrow();
    expectInvalid(parseDecision(revocable.proxy));

    const revokedBeats = Proxy.revocable(proposalRecord().payload.beats, {});
    revokedBeats.revoke();
    const revokedNested = proposalRecord();
    revokedNested.payload.beats = revokedBeats.proxy;
    expect(() => parseRecord(revokedNested)).not.toThrow();
    expectInvalid(parseRecord(revokedNested));

    const prototypeLessBeats = proposalRecord().payload.beats;
    Object.setPrototypeOf(prototypeLessBeats, null);
    const customPrototype = proposalRecord();
    customPrototype.payload.beats = prototypeLessBeats;
    expect(() => parseRecord(customPrototype)).not.toThrow();
    expectInvalid(parseRecord(customPrototype));
    expect(trapCalls).toBe(0);
  });

  it('rejects malformed, colliding, or count-mismatched Main-issued identities', () => {
    const record = proposalRecord();
    expectInvalid(parseRecord({ ...record, id: '../proposal' }));
    expectInvalid(parseRecord({ ...record, target: { kind: 'board', boardId: record.projectId } }));
    expectInvalid(
      parseRecord({ ...record, issuedMemberIds: { ...record.issuedMemberIds, beatIds: [record.id, 'beat_2'] } })
    );
    expectInvalid(parseRecord({ ...record, target: { kind: 'board', boardId: '../board' } }));
    expectInvalid(
      parseRecord({
        ...record,
        issuedMemberIds: { ...record.issuedMemberIds, beatIds: ['beat_1'] },
      })
    );
    expectInvalid(
      parseRecord({
        ...record,
        issuedMemberIds: { ...record.issuedMemberIds, shotIds: ['shot_1', 'shot_2'] },
      })
    );
    expectInvalid(
      parseRecord({
        ...record,
        issuedMemberIds: { beatIds: ['beat_1', 'beat_2'], shotIds: ['shot_1', 'board_1', 'shot_3'] },
      })
    );
    expectInvalid(parseRecord({ ...record, baseAuthoringRevision: 0 }));
    expectInvalid(parseRecord({ ...record, createdAt: 'not-a-timestamp' }));
    expectInvalid(parseRecord({ ...record, expiresAt: '2026-09-09T01:00:00.001Z' }));
    expectInvalid(
      parseRecord({
        ...record,
        source: { ...record.source, commandId: 'command_2' },
      })
    );
    expectInvalid(
      parseRecord({
        ...record,
        source: { ...record.source, commandSha256: 'A'.repeat(64) },
      })
    );
    expectInvalid(
      parseRecord({
        ...record,
        payload: { ...record.payload, beats: [{ ...record.payload.beats[0]!, shots: [] }] },
      })
    );
    expectInvalid(parseStudioProposalRecordV4({ projectId: 'other_project', proposalId, value: record }));
  });

  it('rejects non-array, unsafe, and duplicate Main-issued identity lists', () => {
    const record = proposalRecord();
    for (const issuedMemberIds of [
      { ...record.issuedMemberIds, beatIds: 'beat_1' },
      { ...record.issuedMemberIds, beatIds: ['../beat', 'beat_2'] },
      { ...record.issuedMemberIds, beatIds: ['beat_1', 'beat_1'] },
    ]) {
      expectInvalid(parseRecord({ ...record, issuedMemberIds }));
    }
  });

  it('rejects a canonical proposal timestamp whose required expiry cannot be represented', () => {
    const record = proposalRecord();
    record.createdAt = '9999-12-31T23:59:59.999Z';
    record.expiresAt = record.createdAt;

    expectInvalid(parseRecord(record));
  });

  it('rejects a semantically bounded Board whose immutable sidecar exceeds the record budget', () => {
    const record = proposalRecord();
    const shootingScript = 'x'.repeat(STUDIO_MAX_SHOOTING_SCRIPT_LENGTH);
    record.payload.beats = [
      {
        title: 'Oversized record',
        story: '',
        targetSeconds: null,
        shots: Array.from({ length: 11 }, (_, index) => ({
          shootingScript: `${index}${shootingScript}`.slice(0, STUDIO_MAX_SHOOTING_SCRIPT_LENGTH),
          durationSeconds: 1,
        })),
      },
    ];
    record.issuedMemberIds = {
      beatIds: ['beat_1'],
      shotIds: Array.from({ length: 11 }, (_, index) => `shot_${index + 1}`),
    };

    expectInvalid(parseRecord(record));
  });

  it('refuses multi-target, paid-recovery, authorization, and generic-batch proposal shapes', () => {
    const record = proposalRecord();
    expectInvalid(parseRecord({ ...record, target: [record.target, { kind: 'board', boardId: 'board_2' }] }));
    expectInvalid(
      parseRecord({
        ...record,
        target: { kind: 'blocks', blockIds: ['board_1', 'board_2'] },
      })
    );
    expectInvalid(
      parseRecord({
        ...record,
        payload: { kind: 'mutation_batch', operations: [] },
      })
    );
    expectInvalid(
      parseRecord({
        ...record,
        payload: { kind: 'paid_recovery', blocker: {}, quote: { currency: 'USD', lowerMinorUnits: 1 } },
      })
    );
    expectInvalid(parseAttribution({ ...proposalAttribution(), kind: 'paid_recovery' }));
  });

  it('rejects nonterminal decisions and mismatched project or proposal authority', () => {
    expectInvalid(parseDecision({ ...proposalDecision(), status: 'pending' }));
    expectInvalid(parseDecision({ ...proposalDecision(), status: 'approved' }));
    expectInvalid(parseDecision({ ...proposalDecision(), projectId: 'project_2' }));
    expectInvalid(parseDecision({ ...proposalDecision(), proposalId: 'proposal_2' }));
  });

  it('requires exact authoring/general revision increments and immutable-record evidence', () => {
    for (const value of [
      { ...proposalAttribution(), beforeAuthoringRevision: 2 },
      { ...proposalAttribution(), afterAuthoringRevision: 5 },
      { ...proposalAttribution(), beforeRevision: 0 },
      { ...proposalAttribution(), afterRevision: 9 },
      { ...proposalAttribution(), beforeRevision: 2, afterRevision: 3 },
      { ...proposalAttribution(), target: { kind: 'board', boardId: 'board_2' } },
      { ...proposalAttribution(), createdBeatIds: ['beat_2', 'beat_1'] },
      { ...proposalAttribution(), createdShotIds: ['shot_1', 'shot_2'] },
      { ...proposalAttribution(), proposalSha256: 'A'.repeat(64) },
      { ...proposalAttribution(), proposalSha256: 'a'.repeat(64) },
      { ...proposalAttribution(), beforeManifestSha256: 'short' },
      { ...proposalAttribution(), afterManifestSha256: shaB },
      { ...proposalAttribution(), afterManifestSha256: `${'d'.repeat(63)}g` },
      { ...proposalAttribution(), committedAt: '2026-09-02T00:59:59.000Z' },
      { ...proposalAttribution(), committedAt: expiresAt },
      { ...proposalAttribution(), committedAt: '+012345-01-01T00:00:00.000Z' },
    ]) {
      expectInvalid(parseAttribution(value));
    }
    expectInvalid(parseAttribution(proposalAttribution(), '{not json'));
  });

  it('rejects unbounded or semantically invalid frozen proposal bytes before trusting commit attribution', () => {
    expectInvalid(parseAttribution(proposalAttribution(), 1 as unknown as string));
    expectInvalid(parseAttribution(proposalAttribution(), 'x'.repeat(STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4 + 1)));
    const invalidProposalBytes = proposalBytes({ ...proposalRecord(), decidedAt });
    expectInvalid(parseAttribution(proposalAttribution(invalidProposalBytes), invalidProposalBytes));
  });

  it('accepts bounded canonical terminal transactions for all three outcomes', () => {
    const transactions = [
      proposalAcceptTransaction(),
      proposalSettlementTransaction('rejected'),
      proposalSettlementTransaction('expired'),
    ];

    expect(STUDIO_PROPOSAL_TERMINAL_TRANSACTION_MAX_BYTES_V4).toBe(65_536);
    for (const transaction of transactions) {
      expect(parseTerminalTransaction(transaction)).toEqual({ status: 'valid', record: transaction });
      expect(Buffer.byteLength(JSON.stringify(transaction), 'utf8')).toBeLessThan(
        STUDIO_PROPOSAL_TERMINAL_TRANSACTION_MAX_BYTES_V4
      );
    }
  });

  it('classifies future terminal-transaction schemas and rejects every other wrong discriminator', () => {
    const transaction = proposalAcceptTransaction();
    expect(parseTerminalTransaction({ ...transaction, schemaVersion: 2 })).toEqual({
      status: 'unsupported_prototype_schema',
    });
    for (const schemaVersion of [0, -1, 1.5, '1', null]) {
      expectInvalid(parseTerminalTransaction({ ...transaction, schemaVersion }));
    }
  });

  it('rejects malformed or uncorrelated terminal transaction evidence', () => {
    const transaction = proposalAcceptTransaction();
    const rejectedDecisionBytes = JSON.stringify({ ...proposalDecision(), status: 'rejected' });
    const wrongTimestampDecisionBytes = JSON.stringify({
      ...proposalDecision(),
      decidedAt: '2026-09-02T01:02:00.000Z',
    });
    const noncanonicalCommitBytes = JSON.stringify(proposalAttribution(), null, 2);
    const noncanonicalDecisionBytes = JSON.stringify(proposalDecision(), null, 2);

    for (const value of [
      { ...transaction, kind: 'accept_piece' },
      { ...transaction, proposalId: 'proposal_2' },
      { ...transaction, projectId: 'project_2' },
      { ...transaction, proposalSha256: 'a'.repeat(64) },
      { ...transaction, proposalSha256: 'A'.repeat(64) },
      { ...transaction, commitBytes: '{not json' },
      { ...transaction, decisionBytes: '{not json' },
      { ...transaction, decisionBytes: rejectedDecisionBytes },
      { ...transaction, decisionBytes: wrongTimestampDecisionBytes },
      { ...transaction, commitBytes: noncanonicalCommitBytes },
      { ...transaction, decisionBytes: noncanonicalDecisionBytes },
      { ...transaction, authorizationId: null },
    ]) {
      expectInvalid(parseTerminalTransaction(value));
    }

    const otherProposal = proposalRecord();
    otherProposal.payload.handle = 'different_board';
    const otherProposalBytes = proposalBytes(otherProposal);
    expectInvalid(parseTerminalTransaction(transaction, otherProposalBytes));
  });

  it('requires exact keys and a discriminator-matched decision on non-commit terminal arms', () => {
    const rejected = proposalSettlementTransaction('rejected');
    const expired = proposalSettlementTransaction('expired');
    for (const value of [
      { ...rejected, decisionBytes: JSON.stringify({ ...proposalDecision(), status: 'expired' }) },
      { ...expired, decisionBytes: JSON.stringify({ ...proposalDecision(), status: 'rejected' }) },
      { ...rejected, commitBytes: JSON.stringify(proposalAttribution()) },
      { ...rejected, proposalSha256: 'a'.repeat(64) },
      { ...rejected, decisionBytes: JSON.stringify({ ...proposalDecision(), status: 'rejected' }, null, 2) },
    ]) {
      expectInvalid(parseTerminalTransaction(value));
    }
    const { commitBytes: _omitted, ...acceptWithoutCommit } = proposalAcceptTransaction();
    expectInvalid(parseTerminalTransaction(acceptWithoutCommit));
  });

  it('rejects malformed, unbounded, and non-round-trippable proposal bytes before trusting terminal intent', () => {
    const transaction = proposalAcceptTransaction();
    expectInvalid(parseTerminalTransaction(transaction, 1 as unknown as string));
    expectInvalid(parseTerminalTransaction(transaction, 'x'.repeat(STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4 + 1)));
    expectInvalid(parseTerminalTransaction(transaction, '\ud800'));

    const malformedProposalBytes = '{not json';
    expectInvalid(parseTerminalTransaction(proposalAcceptTransaction(malformedProposalBytes), malformedProposalBytes));

    const invalidProposalBytes = proposalBytes({ ...proposalRecord(), decidedAt });
    expectInvalid(parseTerminalTransaction(proposalAcceptTransaction(invalidProposalBytes), invalidProposalBytes));

    const unsupportedProposalBytes = proposalBytes({ ...proposalRecord(), schemaVersion: 6 });
    expect(
      parseTerminalTransaction(proposalAcceptTransaction(unsupportedProposalBytes), unsupportedProposalBytes)
    ).toEqual({ status: 'invalid' });
  });

  it('rejects accessor and revoked-proxy terminal transactions without invoking traps', () => {
    let getterCalls = 0;
    const accessor = proposalAcceptTransaction() as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, 'commitBytes', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return proposalAcceptTransaction().commitBytes;
      },
    });
    expectInvalid(parseTerminalTransaction(accessor));

    const kindAccessor = proposalSettlementTransaction('rejected') as unknown as Record<string, unknown>;
    Object.defineProperty(kindAccessor, 'kind', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('must not run');
      },
    });
    expect(() => parseTerminalTransaction(kindAccessor)).not.toThrow();
    expectInvalid(parseTerminalTransaction(kindAccessor));

    const revocable = Proxy.revocable(proposalAcceptTransaction(), {});
    revocable.revoke();
    expect(() => parseTerminalTransaction(revocable.proxy)).not.toThrow();
    expectInvalid(parseTerminalTransaction(revocable.proxy));
    expect(getterCalls).toBe(0);
  });
});
