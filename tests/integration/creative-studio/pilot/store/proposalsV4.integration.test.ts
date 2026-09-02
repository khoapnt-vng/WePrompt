/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
import { promises as nodeFs } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { STUDIO_MAX_SHOOTING_SCRIPT_LENGTH } from '@/common/types/project/creativeStudioTypes';
import {
  STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  type StudioProposalRecordV4,
} from '@process/services/creative-studio/service/schema2/proposals/proposalContractsV4';
import {
  createCreativeStudioPilotStoreV4,
  createCreativeStudioProposalSidecarsV4,
  type CreativeStudioPilotStoreV4,
  type CreativeStudioProposalSidecarErrorV4,
  type CreativeStudioProposalSidecarsOptionsV4,
} from '@process/services/creative-studio/store/pilot';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const createdAt = '2026-09-02T01:00:00.000Z';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-proposals-v4-'));
  roots.push(root);
  return root;
};

const createProjectStore = (rootDir: string): CreativeStudioPilotStoreV4 => {
  let temporaryId = 0;
  return createCreativeStudioPilotStoreV4({
    rootDir,
    now: () => '2026-09-02T00:00:00.000Z',
    createProjectId: () => 'project_1',
    createTemporaryId: () => `temporary_${String(++temporaryId).padStart(8, '0')}`,
  });
};

const proposalRecord = (overrides: Partial<StudioProposalRecordV4> = {}): StudioProposalRecordV4 => ({
  schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  id: 'proposal_1',
  projectId: 'project_1',
  status: 'pending',
  baseAuthoringRevision: 1,
  target: { kind: 'board', boardId: 'board_1' },
  issuedMemberIds: { beatIds: ['beat_1'], shotIds: ['shot_1'] },
  payload: {
    kind: 'create_board',
    handle: 'harbour_board',
    beats: [
      {
        title: 'Arrival',
        story: 'A boat enters the harbour.',
        targetSeconds: 4,
        shots: [{ shootingScript: 'Wide harbour at dawn.', durationSeconds: 4 }],
      },
    ],
  },
  createdAt,
  decidedAt: null,
  ...overrides,
});

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
  if (finalScriptLength < 1 || finalScriptLength > STUDIO_MAX_SHOOTING_SCRIPT_LENGTH) {
    throw new Error('Boundary fixture cannot reach requested byte length');
  }
  record.payload.beats[0]!.shots[10]!.shootingScript = 'x'.repeat(finalScriptLength);
  if (Buffer.byteLength(JSON.stringify(record), 'utf8') !== targetByteLength) {
    throw new Error('Boundary fixture has the wrong byte length');
  }
  return record;
};

const recordInput = (proposal = proposalRecord()) => ({
  projectId: proposal.projectId,
  proposalId: proposal.id,
  proposal,
});

const createHarness = async (
  root: string,
  sidecarOptions: Partial<Omit<CreativeStudioProposalSidecarsOptionsV4, 'projectStore'>> = {}
) => {
  const projectStore = createProjectStore(root);
  await projectStore.createProjectV4({ name: 'Harbour', brief: 'A boat reaches shore.' });
  let temporaryId = 0;
  const sidecars = createCreativeStudioProposalSidecarsV4({
    projectStore,
    createTemporaryId: () => `proposal_temp_${String(++temporaryId).padStart(8, '0')}`,
    ...sidecarOptions,
  });
  return { projectStore, sidecars };
};

const sha256Utf8 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const proposalDirectory = (root: string): string => path.join(root, 'project_1', 'proposals');
const pendingFile = (root: string): string => path.join(proposalDirectory(root), 'pending-v4.json');

const expectSidecarError = async (
  promise: Promise<unknown>,
  code: CreativeStudioProposalSidecarErrorV4['code']
): Promise<void> => {
  await expect(promise).rejects.toMatchObject({ name: 'CreativeStudioProposalSidecarErrorV4', code });
};

type MutationTracker = { fs: typeof nodeFs; count: () => number };

const mutationTrackingFs = (): MutationTracker => {
  let mutations = 0;
  const fs = {
    ...nodeFs,
    mkdir: (async (...args: Parameters<typeof nodeFs.mkdir>) => {
      mutations += 1;
      return nodeFs.mkdir(...args);
    }) as typeof nodeFs.mkdir,
    link: (async (...args: Parameters<typeof nodeFs.link>) => {
      mutations += 1;
      return nodeFs.link(...args);
    }) as typeof nodeFs.link,
    rename: (async (...args: Parameters<typeof nodeFs.rename>) => {
      mutations += 1;
      return nodeFs.rename(...args);
    }) as typeof nodeFs.rename,
    rm: (async (...args: Parameters<typeof nodeFs.rm>) => {
      mutations += 1;
      return nodeFs.rm(...args);
    }) as typeof nodeFs.rm,
    open: (async (...args: Parameters<typeof nodeFs.open>) => {
      if (args[1] === 'wx') mutations += 1;
      return nodeFs.open(...args);
    }) as typeof nodeFs.open,
  } as typeof nodeFs;
  return { fs, count: () => mutations };
};

describe('schema-7 Board proposal sidecar store', () => {
  it('persists exact immutable proposal bytes, slot authority, and deterministic attribution across restart', async () => {
    const root = await temporaryRoot();
    const { projectStore, sidecars } = await createHarness(root);
    const proposal = proposalRecord();

    const recorded = await sidecars.recordProposalV4(recordInput(proposal));

    expect(recorded.status).toBe('recorded');
    if (recorded.status !== 'recorded') return;
    expect(recorded.proposalBytes).toBe(JSON.stringify(proposal));
    expect(recorded.proposalSha256).toBe(sha256Utf8(recorded.proposalBytes));
    expect(recorded.slot).toEqual({
      schemaVersion: 7,
      proposalId: proposal.id,
      projectId: proposal.projectId,
      reservedAt: proposal.createdAt,
    });

    const restarted = createCreativeStudioProposalSidecarsV4({ projectStore });
    await expect(restarted.getPendingProposalV4('project_1')).resolves.toEqual({
      record: proposal,
      slot: recorded.slot,
      proposalBytes: recorded.proposalBytes,
      proposalSha256: recorded.proposalSha256,
      baseRevision: 1,
      baseAuthoringRevision: 1,
    });
  });

  it('accepts a proposal whose canonical UTF-8 bytes are exactly 262144', async () => {
    const root = await temporaryRoot();
    const { sidecars } = await createHarness(root);
    const proposal = proposalRecordWithSerializedByteLength(STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4);

    const result = await sidecars.recordProposalV4(recordInput(proposal));

    expect(result.status).toBe('recorded');
    if (result.status !== 'recorded') return;
    expect(Buffer.byteLength(result.proposalBytes, 'utf8')).toBe(262_144);
  });

  it('refuses invalid payload before project, pending, or size checks and performs no sidecar write', async () => {
    const root = await temporaryRoot();
    const { projectStore, sidecars: writer } = await createHarness(root);
    await writer.recordProposalV4(recordInput());
    await projectStore.updateProjectV4(
      'project_1',
      (project) => ({ ...project, name: 'Changed', revision: 2, authoringRevision: 2 }),
      { kind: 'authoring', expectedRevision: 1 }
    );
    const tracker = mutationTrackingFs();
    const sidecars = createCreativeStudioProposalSidecarsV4({ projectStore, fs: tracker.fs });
    const invalid = proposalRecordWithSerializedByteLength(
      STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4 + 1
    ) as unknown as Record<string, unknown>;
    invalid.extra = true;

    await expect(
      sidecars.recordProposalV4({ projectId: 'project_1', proposalId: 'proposal_2', proposal: invalid })
    ).resolves.toEqual({ status: 'refused', reason: 'invalid_payload' });
    expect(tracker.count()).toBe(0);
  });

  it('refuses stale authoring before an existing pending record or the size envelope and performs no write', async () => {
    const root = await temporaryRoot();
    const { projectStore, sidecars: writer } = await createHarness(root);
    await writer.recordProposalV4(recordInput());
    await projectStore.updateProjectV4(
      'project_1',
      (project) => ({ ...project, name: 'Changed', revision: 2, authoringRevision: 2 }),
      { kind: 'authoring', expectedRevision: 1 }
    );
    const tracker = mutationTrackingFs();
    const sidecars = createCreativeStudioProposalSidecarsV4({ projectStore, fs: tracker.fs });
    const oversized = proposalRecordWithSerializedByteLength(STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4 + 1);
    oversized.id = 'proposal_2';
    oversized.target.boardId = 'board_2';

    await expect(sidecars.recordProposalV4(recordInput(oversized))).resolves.toEqual({
      status: 'refused',
      reason: 'stale_authoring',
    });
    expect(tracker.count()).toBe(0);
  });

  it('refuses an existing pending proposal before an oversized request and performs no write', async () => {
    const root = await temporaryRoot();
    const { projectStore, sidecars: writer } = await createHarness(root);
    await writer.recordProposalV4(recordInput());
    const tracker = mutationTrackingFs();
    const sidecars = createCreativeStudioProposalSidecarsV4({ projectStore, fs: tracker.fs });
    const oversized = proposalRecordWithSerializedByteLength(STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4 + 1);
    oversized.id = 'proposal_2';
    oversized.target.boardId = 'board_2';

    await expect(sidecars.recordProposalV4(recordInput(oversized))).resolves.toEqual({
      status: 'refused',
      reason: 'existing_pending',
    });
    expect(tracker.count()).toBe(0);
  });

  it('returns a typed one-byte-over refusal only after prior checks and performs no write', async () => {
    const root = await temporaryRoot();
    const { projectStore } = await createHarness(root);
    const tracker = mutationTrackingFs();
    const sidecars = createCreativeStudioProposalSidecarsV4({ projectStore, fs: tracker.fs });
    const oversized = proposalRecordWithSerializedByteLength(STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4 + 1);

    await expect(sidecars.recordProposalV4(recordInput(oversized))).resolves.toEqual({
      status: 'refused',
      reason: 'proposal_too_large',
      byteLength: 262_145,
      maxBytes: 262_144,
    });
    expect(tracker.count()).toBe(0);
    await expect(readdir(path.join(root, 'project_1'))).resolves.toEqual(['brief.md', 'project.json']);
  });

  it('treats an oversized persisted proposal as corrupt rather than a recoverable refusal', async () => {
    const root = await temporaryRoot();
    const { sidecars } = await createHarness(root);
    await sidecars.recordProposalV4(recordInput());
    const envelope = JSON.parse(await readFile(pendingFile(root), 'utf8')) as Record<string, unknown>;
    const oversized = proposalRecordWithSerializedByteLength(STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4 + 1);
    const proposalBytes = JSON.stringify(oversized);
    envelope.proposalBytes = proposalBytes;
    envelope.proposalSha256 = sha256Utf8(proposalBytes);
    await writeFile(pendingFile(root), JSON.stringify(envelope), 'utf8');

    await expectSidecarError(sidecars.getPendingProposalV4('project_1'), 'storage_error');
  });

  it('rejects malformed proposal semantics and mismatched attribution inside a persisted envelope', async () => {
    const root = await temporaryRoot();
    const { sidecars } = await createHarness(root);
    await sidecars.recordProposalV4(recordInput());
    const original = await readFile(pendingFile(root), 'utf8');
    const envelope = JSON.parse(original) as Record<string, unknown>;
    const malformed = proposalRecord();
    malformed.payload.beats[0]!.shots[0]!.durationSeconds = 0;
    envelope.proposalBytes = JSON.stringify(malformed);
    envelope.proposalSha256 = sha256Utf8(envelope.proposalBytes as string);
    await writeFile(pendingFile(root), JSON.stringify(envelope), 'utf8');
    await expectSidecarError(sidecars.getPendingProposalV4('project_1'), 'storage_error');

    await writeFile(pendingFile(root), original, 'utf8');
    const mismatched = JSON.parse(original) as Record<string, unknown>;
    mismatched.proposalSha256 = 'a'.repeat(64);
    await writeFile(pendingFile(root), JSON.stringify(mismatched), 'utf8');
    await expectSidecarError(sidecars.getPendingProposalV4('project_1'), 'storage_error');
  });

  it('rejects an unsupported slot protocol and non-canonical envelope bytes', async () => {
    const root = await temporaryRoot();
    const { sidecars } = await createHarness(root);
    await sidecars.recordProposalV4(recordInput());
    const original = await readFile(pendingFile(root), 'utf8');
    const unsupportedSlot = JSON.parse(original) as Record<string, unknown>;
    unsupportedSlot.slot = { ...(unsupportedSlot.slot as Record<string, unknown>), schemaVersion: 6 };
    await writeFile(pendingFile(root), JSON.stringify(unsupportedSlot), 'utf8');
    await expectSidecarError(sidecars.getPendingProposalV4('project_1'), 'unsupported_prototype_schema');

    await writeFile(pendingFile(root), `${original}\n`, 'utf8');
    await expectSidecarError(sidecars.getPendingProposalV4('project_1'), 'storage_error');
  });

  it('fails closed on an unsupported persisted proposal protocol without reading it as schema 7', async () => {
    const root = await temporaryRoot();
    const { sidecars } = await createHarness(root);
    await sidecars.recordProposalV4(recordInput());
    const envelope = JSON.parse(await readFile(pendingFile(root), 'utf8')) as Record<string, unknown>;
    const legacy = { ...proposalRecord(), schemaVersion: 6 };
    const proposalBytes = JSON.stringify(legacy);
    envelope.proposalBytes = proposalBytes;
    envelope.proposalSha256 = sha256Utf8(proposalBytes);
    await writeFile(pendingFile(root), JSON.stringify(envelope), 'utf8');

    await expectSidecarError(sidecars.getPendingProposalV4('project_1'), 'unsupported_prototype_schema');
  });

  it('recovers a fully linked pending record after interruption before the directory durability barrier', async () => {
    const root = await temporaryRoot();
    const { projectStore } = await createHarness(root);
    const interrupted = createCreativeStudioProposalSidecarsV4({
      projectStore,
      createTemporaryId: () => 'proposal_temp_00000001',
      onStorageStep: (step) => {
        if (step === 'pending_linked') throw new Error('simulated process interruption');
      },
    });

    await expectSidecarError(interrupted.recordProposalV4(recordInput()), 'storage_error');
    const restarted = createCreativeStudioProposalSidecarsV4({ projectStore });
    await expect(restarted.getPendingProposalV4('project_1')).resolves.toMatchObject({
      record: { id: 'proposal_1' },
      proposalSha256: sha256Utf8(JSON.stringify(proposalRecord())),
    });
    await expect(readdir(proposalDirectory(root))).resolves.toEqual(['pending-v4.json']);
    await expect(
      restarted.recordProposalV4(
        recordInput(proposalRecord({ id: 'proposal_2', target: { kind: 'board', boardId: 'board_2' } }))
      )
    ).resolves.toEqual({ status: 'refused', reason: 'existing_pending' });
  });

  it('publishes exactly one pending record when two Main instances race the empty slot', async () => {
    const root = await temporaryRoot();
    const firstStore = createProjectStore(root);
    await firstStore.createProjectV4({ name: 'Harbour', brief: 'A boat reaches shore.' });
    const secondStore = createProjectStore(root);
    let waiting = 0;
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waitAtTemporary = async (step: string): Promise<void> => {
      if (step !== 'temporary_durable') return;
      waiting += 1;
      if (waiting === 2) release?.();
      await barrier;
    };
    const first = createCreativeStudioProposalSidecarsV4({
      projectStore: firstStore,
      createTemporaryId: () => 'proposal_temp_00000001',
      onStorageStep: waitAtTemporary,
    });
    const second = createCreativeStudioProposalSidecarsV4({
      projectStore: secondStore,
      createTemporaryId: () => 'proposal_temp_00000002',
      onStorageStep: waitAtTemporary,
    });
    const secondProposal = proposalRecord({ id: 'proposal_2', target: { kind: 'board', boardId: 'board_2' } });

    const results = await Promise.all([
      first.recordProposalV4(recordInput()),
      second.recordProposalV4(recordInput(secondProposal)),
    ]);

    expect(results.map((result) => result.status).toSorted()).toEqual(['recorded', 'refused']);
    expect(results.find((result) => result.status === 'refused')).toEqual({
      status: 'refused',
      reason: 'existing_pending',
    });
    expect(await readdir(proposalDirectory(root))).toEqual(['pending-v4.json']);
  });

  it('publishes a still-current proposal across unrelated runtime progress', async () => {
    const root = await temporaryRoot();
    const { projectStore } = await createHarness(root);
    const competingStore = createProjectStore(root);
    const sidecars = createCreativeStudioProposalSidecarsV4({
      projectStore,
      createTemporaryId: () => 'proposal_temp_00000001',
      onStorageStep: async (step) => {
        if (step !== 'temporary_durable') return;
        await competingStore.updateProjectV4('project_1', (project) => ({ ...project, revision: 2 }), {
          kind: 'runtime',
          expectedRevision: 1,
        });
      },
    });

    await expect(sidecars.recordProposalV4(recordInput())).resolves.toMatchObject({
      status: 'recorded',
      baseRevision: 1,
      baseAuthoringRevision: 1,
    });
    await expect(readdir(proposalDirectory(root))).resolves.toEqual(['pending-v4.json']);
  });

  it('removes its unpublished temporary when authored state changes before linking', async () => {
    const root = await temporaryRoot();
    const { projectStore } = await createHarness(root);
    const competingStore = createProjectStore(root);
    const sidecars = createCreativeStudioProposalSidecarsV4({
      projectStore,
      createTemporaryId: () => 'proposal_temp_00000001',
      onStorageStep: async (step) => {
        if (step !== 'temporary_durable') return;
        await competingStore.updateProjectV4('project_1', (project) => ({ ...project, name: 'Changed' }), {
          kind: 'authoring',
          expectedRevision: 1,
        });
      },
    });

    await expect(sidecars.recordProposalV4(recordInput())).rejects.toMatchObject({
      name: 'CreativeStudioPilotStoreErrorV4',
      code: 'stale_project',
    });
    await expect(readdir(proposalDirectory(root))).resolves.toEqual([]);
  });

  it('fails closed on unlinked or unrelated temporary residue instead of trusting its filename', async () => {
    const root = await temporaryRoot();
    const { projectStore } = await createHarness(root);
    const sidecars = createCreativeStudioProposalSidecarsV4({
      projectStore,
      mainInstanceId: 'current_main_01',
    });
    await mkdir(proposalDirectory(root));
    const residue = path.join(proposalDirectory(root), 'pending-v4.json.current_main_01.residue_00000001.tmp');
    await writeFile(residue, 'not an envelope', 'utf8');

    await expectSidecarError(sidecars.getPendingProposalV4('project_1'), 'storage_error');

    await rm(residue);
    await sidecars.recordProposalV4(recordInput());
    await writeFile(residue, 'not the linked record', 'utf8');
    await expectSidecarError(sidecars.getPendingProposalV4('project_1'), 'storage_error');
  });

  it('bounds proposal-directory traversal before examining an unbounded residue family', async () => {
    const root = await temporaryRoot();
    const { projectStore } = await createHarness(root);
    const sidecars = createCreativeStudioProposalSidecarsV4({
      projectStore,
      mainInstanceId: 'current_main_01',
    });
    await mkdir(proposalDirectory(root));
    await Promise.all(
      Array.from({ length: 9 }, (_, index) =>
        writeFile(
          path.join(
            proposalDirectory(root),
            `pending-v4.json.current_main_01.residue_${String(index).padStart(8, '0')}.tmp`
          ),
          '{}',
          'utf8'
        )
      )
    );

    await expectSidecarError(sidecars.getPendingProposalV4('project_1'), 'storage_error');
  });

  it('reclaims unpublished residue from a prior Main instance after restart', async () => {
    const root = await temporaryRoot();
    const { projectStore } = await createHarness(root);
    await mkdir(proposalDirectory(root));
    await writeFile(
      path.join(proposalDirectory(root), 'pending-v4.json.previous_main_01.residue_00000001.tmp'),
      'partial pre-link bytes',
      'utf8'
    );
    const restarted = createCreativeStudioProposalSidecarsV4({
      projectStore,
      mainInstanceId: 'current_main_01',
    });

    await expect(restarted.getPendingProposalV4('project_1')).resolves.toBeNull();
    await expect(readdir(proposalDirectory(root))).resolves.toEqual([]);
    await expect(restarted.recordProposalV4(recordInput())).resolves.toMatchObject({ status: 'recorded' });
  });

  it('rejects unsafe proposal directories and never follows them outside the project', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const { sidecars } = await createHarness(root);
    await symlink(outside, proposalDirectory(root));

    await expectSidecarError(sidecars.recordProposalV4(recordInput()), 'storage_error');
    await expect(readdir(outside)).resolves.toEqual([]);
  });

  it('rejects symlinked pending records and unexpected recovery names', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const { sidecars } = await createHarness(root);
    await mkdir(proposalDirectory(root));
    await writeFile(path.join(outside, 'foreign.json'), '{}', 'utf8');
    await symlink(path.join(outside, 'foreign.json'), pendingFile(root));

    await expectSidecarError(sidecars.getPendingProposalV4('project_1'), 'storage_error');
    await rm(pendingFile(root));
    await writeFile(path.join(proposalDirectory(root), 'unexpected.tmp'), '{}', 'utf8');
    await expectSidecarError(sidecars.getPendingProposalV4('project_1'), 'storage_error');
  });

  it('refuses traversal and outer accessors without creating proposal storage', async () => {
    const root = await temporaryRoot();
    const { projectStore } = await createHarness(root);
    const tracker = mutationTrackingFs();
    const sidecars = createCreativeStudioProposalSidecarsV4({ projectStore, fs: tracker.fs });
    let getterCalls = 0;
    const accessor = { projectId: 'project_1', proposalId: '../proposal', proposal: proposalRecord() };
    Object.defineProperty(accessor, 'proposal', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return proposalRecord();
      },
    });

    await expect(sidecars.recordProposalV4(accessor)).resolves.toEqual({
      status: 'refused',
      reason: 'invalid_payload',
    });
    expect(getterCalls).toBe(0);
    expect(tracker.count()).toBe(0);
  });
});
