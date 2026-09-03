/** @vitest-environment node */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  deriveStudioProposalExpiresAtV4,
  deriveStudioProposalIdV4,
  STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  type StudioProposalRecordV4,
} from '@process/services/creative-studio/service/schema2/proposals/proposalContractsV4';
import { STUDIO_MAX_BOARDS_V4, STUDIO_MAX_SHOOTING_SCRIPT_LENGTH } from '@/common/types/project/creativeStudioTypes';
import {
  CreativeStudioPilotStoreErrorV4,
  createCreativeStudioPilotStoreV4,
  createCreativeStudioProposalSidecarsV4,
} from '@process/services/creative-studio/store/pilot';
import { afterEach, describe, expect, it } from 'vitest';
const roots: string[] = [];
afterEach(() => Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))));
const createdAt = '2026-09-02T01:00:00.000Z';
const proposal = (commandId = 'command_1'): StudioProposalRecordV4 => ({
  schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  id: deriveStudioProposalIdV4('project_1', commandId),
  projectId: 'project_1',
  status: 'pending',
  baseAuthoringRevision: 1,
  source: {
    kind: 'director_command',
    commandId,
    commandSha256: createHash('sha256').update(commandId).digest('hex'),
  },
  target: { kind: 'board', boardId: `board_${commandId}` },
  issuedMemberIds: { beatIds: [`beat_${commandId}`], shotIds: [`shot_${commandId}`] },
  payload: {
    kind: 'create_board',
    handle: `board_${commandId}`,
    beats: [
      {
        title: 'Arrival',
        story: 'A boat arrives.',
        targetSeconds: 4,
        shots: [{ shootingScript: 'Wide harbour.', durationSeconds: 4 }],
      },
    ],
  },
  createdAt,
  expiresAt: deriveStudioProposalExpiresAtV4(createdAt),
  decidedAt: null,
});
const maximumSizedProposal = (): StudioProposalRecordV4 => {
  const value = proposal('maximum_size');
  value.payload.beats = Array.from({ length: 12 }, (_, beatIndex) => ({
    title: `Beat ${beatIndex}`,
    story: 'Exact record-envelope boundary.',
    targetSeconds: null,
    shots: Array.from({ length: 8 }, (_, shotIndex) => ({
      shootingScript: `${beatIndex}-${shotIndex} `,
      durationSeconds: 4,
    })),
  }));
  value.issuedMemberIds.beatIds = Array.from({ length: 12 }, (_, index) => `beat_maximum_${index}`);
  value.issuedMemberIds.shotIds = Array.from({ length: 96 }, (_, index) => `shot_maximum_${index}`);
  let remaining = STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4 - Buffer.byteLength(JSON.stringify(value), 'utf8');
  for (const beat of value.payload.beats) {
    for (const shot of beat.shots) {
      if (remaining === 0) break;
      const added = Math.min(remaining, STUDIO_MAX_SHOOTING_SCRIPT_LENGTH - shot.shootingScript.length);
      shot.shootingScript += 'x'.repeat(added);
      remaining -= added;
    }
  }
  if (remaining !== 0) throw new Error('The valid proposal grammar cannot reach its configured byte ceiling');
  return value;
};
const harness = async (now = () => createdAt) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'proposals-v4-'));
  roots.push(root);
  let n = 0;
  const store = createCreativeStudioPilotStoreV4({
    rootDir: root,
    now,
    createProjectId: () => 'project_1',
    createTemporaryId: () => `temp_${String(++n).padStart(8, '0')}`,
  });
  await store.createProjectV4({ name: 'Test', brief: 'Test' });
  const sidecars = createCreativeStudioProposalSidecarsV4({
    projectStore: store,
    now,
  });
  return { root, store, sidecars };
};
const replay = (sidecars: Awaited<ReturnType<typeof harness>>['sidecars'], p: StudioProposalRecordV4) =>
  sidecars.replayProposalV4({ projectId: p.projectId, proposalId: p.id, proposal: p });
describe('schema-7 proposal family rev2', () => {
  it('fails malformed public inputs closed and isolates proposal observers', async () => {
    const { store, sidecars } = await harness();
    await expect(sidecars.replayProposalV4(null)).resolves.toEqual({
      outcome: 'refused',
      reason: 'invalid_payload',
    });
    await expect(
      sidecars.replayProposalV4({ projectId: 'project_1', proposalId: 'proposal_1', proposal: {}, extra: true })
    ).resolves.toEqual({ outcome: 'refused', reason: 'invalid_payload' });
    const throwingInput = Object.defineProperties(
      {},
      {
        projectId: { enumerable: true, get: () => 'project_1' },
        proposalId: {
          enumerable: true,
          get() {
            throw new Error('must fail closed');
          },
        },
        proposal: { enumerable: true, value: {} },
      }
    );
    await expect(sidecars.replayProposalV4(throwingInput)).resolves.toEqual({
      outcome: 'refused',
      reason: 'invalid_payload',
    });
    await expect(sidecars.acceptProposalV4(null)).resolves.toEqual({ status: 'unknown' });
    await expect(sidecars.rejectProposalV4(null)).resolves.toEqual({ status: 'unknown' });
    await expect(
      sidecars.acceptProposalV4({ projectId: 'project_1', proposalId: deriveStudioProposalIdV4('project_1', 'absent') })
    ).resolves.toEqual({ status: 'unknown' });
    await expect(
      sidecars.rejectProposalV4({ projectId: 'project_1', proposalId: deriveStudioProposalIdV4('project_1', 'absent') })
    ).resolves.toEqual({ status: 'unknown' });

    const observed: string[] = [];
    sidecars.watchProposalsV4(() => {
      throw new Error('one observer cannot suppress the others');
    });
    const unwatch = sidecars.watchProposalsV4((facts) => observed.push(`${facts.status}:${facts.proposalId}`));
    const candidate = proposal('observer_isolation');
    await replay(sidecars, candidate);
    await expect(sidecars.getProposalStateV4(candidate.projectId, candidate.id)).resolves.toMatchObject({
      status: 'pending',
      proposal: { id: candidate.id },
    });
    unwatch();
    await sidecars.rejectProposalV4({ projectId: candidate.projectId, proposalId: candidate.id });
    expect(observed).toEqual([`recorded:${candidate.id}`]);

    const defaultClock = createCreativeStudioProposalSidecarsV4({ projectStore: store });
    await expect(defaultClock.getProposalStateV4('project_1', 'proposal_unknown')).resolves.toEqual({
      status: 'unknown',
    });
  });

  it('uses the production clock when no test clock is injected', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'proposals-v4-default-clock-'));
    roots.push(root);
    const wallClock = new Date().toISOString();
    let temporaryId = 0;
    const store = createCreativeStudioPilotStoreV4({
      rootDir: root,
      now: () => wallClock,
      createProjectId: () => 'project_1',
      createTemporaryId: () => `wall_clock_${String(++temporaryId).padStart(8, '0')}`,
    });
    await store.createProjectV4({ name: 'Test', brief: 'Test' });
    const sidecars = createCreativeStudioProposalSidecarsV4({ projectStore: store });
    const candidate = proposal('default_clock');
    candidate.createdAt = wallClock;
    candidate.expiresAt = deriveStudioProposalExpiresAtV4(wallClock);
    await expect(replay(sidecars, candidate)).resolves.toMatchObject({
      outcome: 'admitted',
      proposalId: candidate.id,
    });
  });

  it('rejects a non-canonical clock without publishing proposal state', async () => {
    const { root, store } = await harness();
    const sidecars = createCreativeStudioProposalSidecarsV4({ projectStore: store, now: () => 'not-a-timestamp' });
    await expect(replay(sidecars, proposal('invalid_clock'))).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'corrupt_storage',
    });
    await expect(readFile(path.join(root, 'project_1', 'proposal', 'current.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('admits one current proposal and uses only the three-path family', async () => {
    const { root, sidecars } = await harness();
    const p = proposal();
    await expect(replay(sidecars, p)).resolves.toMatchObject({ outcome: 'admitted', proposalId: p.id });
    await expect(replay(sidecars, p)).resolves.toMatchObject({ outcome: 'already_pending' });
    expect((await readdir(path.join(root, 'project_1', 'proposal'))).toSorted()).toEqual(['current.json', 'decided']);
  });
  it('distinguishes another pending proposal from a same-id collision', async () => {
    const { sidecars } = await harness();
    const p = proposal();
    await replay(sidecars, p);
    await expect(replay(sidecars, proposal('command_2'))).resolves.toMatchObject({
      outcome: 'busy',
      holdingProposalId: p.id,
    });
    const changed = proposal();
    changed.payload.handle = 'different';
    await expect(replay(sidecars, changed)).resolves.toMatchObject({ outcome: 'identity_collision', proposalId: p.id });
  });
  it('serializes concurrent admissions across independent stores without misreporting corruption', async () => {
    const { root, sidecars } = await harness();
    let n = 0;
    const secondStore = createCreativeStudioPilotStoreV4({
      rootDir: root,
      now: () => createdAt,
      createProjectId: () => 'unused',
      createTemporaryId: () => `second_${String(++n).padStart(8, '0')}`,
    });
    const second = createCreativeStudioProposalSidecarsV4({ projectStore: secondStore, now: () => createdAt });
    const firstProposal = proposal('concurrent_1');
    const secondProposal = proposal('concurrent_2');
    const results = await Promise.all([replay(sidecars, firstProposal), replay(second, secondProposal)]);
    expect(results.map((result) => result.outcome).toSorted()).toEqual(['admitted', 'busy']);
    const admitted = results.find((result) => result.outcome === 'admitted');
    const refused = results.find((result) => result.outcome === 'busy');
    expect(refused).toMatchObject({
      outcome: 'busy',
      holdingProposalId: admitted?.proposalId,
    });
  });
  it('waits for a matching local proposal publication and replays it as already pending', async () => {
    const { root, store } = await harness();
    let releasePublication!: () => void;
    let announceCurrentDurable!: () => void;
    const currentDurable = new Promise<void>((resolve) => {
      announceCurrentDurable = resolve;
    });
    const publicationReleased = new Promise<void>((resolve) => {
      releasePublication = resolve;
    });
    const first = createCreativeStudioProposalSidecarsV4({
      projectStore: store,
      now: () => createdAt,
      onStorageStep: async (step) => {
        if (step !== 'current_durable') return;
        announceCurrentDurable();
        await publicationReleased;
      },
    });
    const candidate = proposal('same_local_publication');
    const firstReplay = replay(first, candidate);
    await currentDurable;

    let n = 0;
    const secondStore = createCreativeStudioPilotStoreV4({
      rootDir: root,
      now: () => createdAt,
      createProjectId: () => 'unused',
      createTemporaryId: () => `second_${String(++n).padStart(8, '0')}`,
    });
    const second = createCreativeStudioProposalSidecarsV4({ projectStore: secondStore, now: () => createdAt });
    let secondSettled = false;
    const secondReplay = replay(second, candidate).finally(() => {
      secondSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(secondSettled).toBe(false);

    releasePublication();
    await expect(firstReplay).resolves.toMatchObject({ outcome: 'admitted', proposalId: candidate.id });
    await expect(secondReplay).resolves.toMatchObject({ outcome: 'already_pending', proposalId: candidate.id });
  });
  it('waits through local writer publication before classifying proposal admission', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'proposals-v4-writer-publication-'));
    roots.push(root);
    let pausePublication = false;
    let releasePublication!: () => void;
    let announceOwnerDurable!: () => void;
    const ownerDurable = new Promise<void>((resolve) => {
      announceOwnerDurable = resolve;
    });
    const publicationReleased = new Promise<void>((resolve) => {
      releasePublication = resolve;
    });
    let n = 0;
    const firstStore = createCreativeStudioPilotStoreV4({
      rootDir: root,
      now: () => createdAt,
      createProjectId: () => 'project_1',
      createTemporaryId: () => `first_${String(++n).padStart(8, '0')}`,
      onWriterGateStep: async (step) => {
        if (!pausePublication || step !== 'owner_durable') return;
        announceOwnerDurable();
        await publicationReleased;
      },
    });
    await firstStore.createProjectV4({ name: 'Test', brief: 'Test' });
    pausePublication = true;
    const heldWriter = firstStore.withProjectWriterAuthorityV4(
      'project_1',
      { purpose: 'project_update' },
      async () => undefined
    );
    await ownerDurable;

    const secondStore = createCreativeStudioPilotStoreV4({
      rootDir: root,
      now: () => createdAt,
      createProjectId: () => 'unused',
      createTemporaryId: () => `second_${String(++n).padStart(8, '0')}`,
    });
    const second = createCreativeStudioProposalSidecarsV4({ projectStore: secondStore, now: () => createdAt });
    const candidate = proposal('after_writer_publication');
    let replaySettled = false;
    const replayed = replay(second, candidate).finally(() => {
      replaySettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(replaySettled).toBe(false);

    releasePublication();
    await expect(heldWriter).resolves.toBeUndefined();
    await expect(replayed).resolves.toMatchObject({ outcome: 'admitted', proposalId: candidate.id });
  });
  it('waits for a local project writer before reclassifying proposal admission', async () => {
    const { root, store } = await harness();
    let n = 0;
    const secondStore = createCreativeStudioPilotStoreV4({
      rootDir: root,
      now: () => createdAt,
      createProjectId: () => 'unused',
      createTemporaryId: () => `second_${String(++n).padStart(8, '0')}`,
    });
    const localWriterWaits: boolean[] = [];
    let announceLocalWriterWait!: () => void;
    const localWriterWaitStarted = new Promise<void>((resolve) => {
      announceLocalWriterWait = resolve;
    });
    const waitForLocalWriter = secondStore.waitForLocalProjectWriterV4.bind(secondStore);
    vi.spyOn(secondStore, 'waitForLocalProjectWriterV4').mockImplementation(async (projectId) => {
      announceLocalWriterWait();
      const observed = await waitForLocalWriter(projectId);
      localWriterWaits.push(observed);
      return observed;
    });
    const second = createCreativeStudioProposalSidecarsV4({ projectStore: secondStore, now: () => createdAt });
    let releaseWriter!: () => void;
    let announceWriter!: () => void;
    const writerEntered = new Promise<void>((resolve) => {
      announceWriter = resolve;
    });
    const writerReleased = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const heldWriter = store.withProjectWriterAuthorityV4('project_1', { purpose: 'project_update' }, async () => {
      announceWriter();
      await writerReleased;
    });
    await writerEntered;

    let replaySettled = false;
    const replayed = replay(second, proposal('after_project_writer')).finally(() => {
      replaySettled = true;
    });
    await localWriterWaitStarted;
    expect(replaySettled).toBe(false);

    releaseWriter();
    await heldWriter;
    const result = await replayed;
    expect({ result, localWriterWaits }).toMatchObject({ result: { outcome: 'admitted' }, localWriterWaits: [true] });
  });
  it('admits only bounded future-skew proposal timestamps', async () => {
    const { sidecars } = await harness();
    const bounded = proposal('future_bounded');
    bounded.createdAt = new Date(Date.parse(createdAt) + 30_000).toISOString();
    bounded.expiresAt = deriveStudioProposalExpiresAtV4(bounded.createdAt);
    await expect(replay(sidecars, bounded)).resolves.toMatchObject({ outcome: 'admitted' });

    const { sidecars: beyondSidecars } = await harness();
    const beyond = proposal('future_beyond');
    beyond.createdAt = new Date(Date.parse(createdAt) + 30_001).toISOString();
    beyond.expiresAt = deriveStudioProposalExpiresAtV4(beyond.createdAt);
    await expect(replay(beyondSidecars, beyond)).resolves.toEqual({ outcome: 'refused', reason: 'stale_authoring' });
  });
  it('settles rejection into permanent history and releases current', async () => {
    const { root, sidecars } = await harness();
    const p = proposal();
    await replay(sidecars, p);
    await expect(sidecars.rejectProposalV4({ projectId: p.projectId, proposalId: p.id })).resolves.toEqual({
      status: 'rejected',
    });
    await expect(replay(sidecars, p)).resolves.toMatchObject({
      outcome: 'already_decided',
      status: 'rejected',
      appliedRevision: null,
    });
    expect(
      JSON.parse(await readFile(path.join(root, 'project_1', 'proposal', 'history.json'), 'utf8')).entries
    ).toHaveLength(1);
    await expect(readFile(path.join(root, 'project_1', 'proposal', 'current.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('settles acceptance once and duplicate terminal returns tombstone facts', async () => {
    const { sidecars } = await harness();
    const p = proposal();
    await replay(sidecars, p);
    await expect(sidecars.acceptProposalV4({ projectId: p.projectId, proposalId: p.id })).resolves.toMatchObject({
      status: 'accepted',
      effect: { kind: 'create_board', boardId: p.target.boardId },
    });
    await expect(sidecars.acceptProposalV4({ projectId: p.projectId, proposalId: p.id })).resolves.toMatchObject({
      status: 'already_accepted',
      decidedAt: createdAt,
      appliedRevision: 2,
    });
  });
  it('returns exact duplicate decisions through both human decision paths', async () => {
    const { sidecars } = await harness();
    const rejected = proposal('duplicate_rejection');
    await replay(sidecars, rejected);
    await sidecars.rejectProposalV4({ projectId: rejected.projectId, proposalId: rejected.id });
    await expect(
      sidecars.rejectProposalV4({ projectId: rejected.projectId, proposalId: rejected.id })
    ).resolves.toEqual({ status: 'rejected' });

    const accepted = proposal('duplicate_acceptance');
    accepted.baseAuthoringRevision = 1;
    const fresh = await harness();
    await replay(fresh.sidecars, accepted);
    await fresh.sidecars.acceptProposalV4({ projectId: accepted.projectId, proposalId: accepted.id });
    await expect(
      fresh.sidecars.rejectProposalV4({ projectId: accepted.projectId, proposalId: accepted.id })
    ).resolves.toMatchObject({ status: 'already_accepted', appliedRevision: 2 });
  });

  it('expires on accept and refuses an authoring-stale pending proposal', async () => {
    let clock = Date.parse(createdAt);
    const expiring = await harness(() => new Date(clock).toISOString());
    const expired = proposal('expired_on_accept');
    await replay(expiring.sidecars, expired);
    clock = Date.parse(expired.expiresAt);
    await expect(
      expiring.sidecars.acceptProposalV4({ projectId: expired.projectId, proposalId: expired.id })
    ).resolves.toEqual({ status: 'expired' });

    const stale = await harness();
    const pending = proposal('stale_on_accept');
    await replay(stale.sidecars, pending);
    await stale.store.updateProjectV4(
      pending.projectId,
      (project) => ({ ...project, name: 'A newer authoring revision' }),
      { expectedRevision: 1, kind: 'authoring', committedAt: createdAt }
    );
    await expect(
      stale.sidecars.acceptProposalV4({ projectId: pending.projectId, proposalId: pending.id })
    ).resolves.toEqual({ status: 'stale_authoring' });
  });

  it('recovers a terminal decision whose history append completed before receipt publication', async () => {
    const { root, store } = await harness();
    let interruptOnce = true;
    const crashing = createCreativeStudioProposalSidecarsV4({
      projectStore: store,
      now: () => createdAt,
      onStorageStep: (step) => {
        if (step === 'history_durable' && interruptOnce) {
          interruptOnce = false;
          throw new Error('simulated receipt interruption');
        }
      },
    });
    const candidate = proposal('history_already_appended');
    await replay(crashing, candidate);
    await expect(
      crashing.rejectProposalV4({ projectId: candidate.projectId, proposalId: candidate.id })
    ).rejects.toThrow('storage_error');

    let temporaryId = 0;
    const restartedStore = createCreativeStudioPilotStoreV4({
      rootDir: root,
      now: () => candidate.expiresAt,
      createProjectId: () => 'unused',
      createTemporaryId: () => `restarted_${String(++temporaryId).padStart(8, '0')}`,
      mainInstanceId: 'main_restarted',
      hasSingleInstanceRecoveryAuthority: () => true,
    });
    const restarted = createCreativeStudioProposalSidecarsV4({
      projectStore: restartedStore,
      now: () => candidate.expiresAt,
    });
    await expect(restarted.recoverPendingProposalV4(candidate.projectId)).resolves.toBeUndefined();
    await expect(restarted.getPendingProposalV4(candidate.projectId)).resolves.toBeNull();
    await expect(replay(restarted, candidate)).resolves.toMatchObject({
      outcome: 'already_decided',
      status: 'rejected',
    });
  });
  it('admits and settles a proposal at the exact payload byte ceiling', async () => {
    const { sidecars } = await harness();
    const p = maximumSizedProposal();
    expect(Buffer.byteLength(JSON.stringify(p), 'utf8')).toBe(STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4);
    await expect(replay(sidecars, p)).resolves.toMatchObject({ outcome: 'admitted', proposalId: p.id });
    await expect(sidecars.rejectProposalV4({ projectId: p.projectId, proposalId: p.id })).resolves.toEqual({
      status: 'rejected',
    });
  });
  it('expires a pending proposal when reject arrives at or after its deadline', async () => {
    let observedAt = createdAt;
    const { sidecars } = await harness(() => observedAt);
    const p = proposal();
    await replay(sidecars, p);
    observedAt = p.expiresAt;
    await expect(sidecars.rejectProposalV4({ projectId: p.projectId, proposalId: p.id })).resolves.toEqual({
      status: 'expired',
    });
    await expect(replay(sidecars, p)).resolves.toMatchObject({ outcome: 'already_decided', status: 'expired' });
  });
  it('passively expires current before reads and releases the one-slot authority', async () => {
    let clock = Date.parse(createdAt);
    const { sidecars } = await harness(() => new Date(clock).toISOString());
    const expired = proposal('passive_expiry');
    await replay(sidecars, expired);
    clock = Date.parse(expired.expiresAt);

    await expect(sidecars.getPendingProposalV4(expired.projectId)).resolves.toBeNull();
    await expect(sidecars.getProposalStateV4(expired.projectId, expired.id)).resolves.toMatchObject({
      status: 'expired',
      proposalId: expired.id,
      decidedAt: expired.expiresAt,
    });

    const replacement = proposal('after_passive_expiry');
    replacement.createdAt = new Date(clock).toISOString();
    replacement.expiresAt = deriveStudioProposalExpiresAtV4(replacement.createdAt);
    await expect(replay(sidecars, replacement)).resolves.toMatchObject({
      outcome: 'admitted',
      proposalId: replacement.id,
    });
  });
  it('checks settled identity before oversized admission', async () => {
    const { sidecars } = await harness();
    const p = proposal();
    await replay(sidecars, p);
    await sidecars.rejectProposalV4({ projectId: p.projectId, proposalId: p.id });
    const changed = proposal();
    changed.payload.beats = Array.from({ length: 12 }, (_, beatIndex) => ({
      title: `Beat ${beatIndex}`,
      story: 'A long but valid beat.',
      targetSeconds: null,
      shots: Array.from({ length: 8 }, (_, shotIndex) => ({
        shootingScript: `${beatIndex}-${shotIndex} ${'x'.repeat(3_000)}`,
        durationSeconds: 4,
      })),
    }));
    changed.issuedMemberIds.beatIds = Array.from({ length: 12 }, (_, index) => `other_beat_${index}`);
    changed.issuedMemberIds.shotIds = Array.from({ length: 96 }, (_, index) => `other_shot_${index}`);
    const result = await replay(sidecars, changed);
    expect(result).toMatchObject({ outcome: 'identity_collision', proposalId: p.id });
  });
  it('uses canonical payload SHA tombstones', async () => {
    const { root, sidecars } = await harness();
    const p = proposal();
    await replay(sidecars, p);
    await sidecars.rejectProposalV4({ projectId: p.projectId, proposalId: p.id });
    const history = JSON.parse(await readFile(path.join(root, 'project_1', 'proposal', 'history.json'), 'utf8'));
    expect(history.entries[0].payloadSha256).toBe(createHash('sha256').update(JSON.stringify(p)).digest('hex'));
    expect(history.entries[0].commandSha256).toBe(p.source.commandSha256);
  });
  it('fails a new admission closed when the durable decision clock rolls backward', async () => {
    let clock = Date.parse(createdAt) + 60_000;
    const { root, sidecars } = await harness(() => new Date(clock).toISOString());
    const settled = proposal('clock_anchor');
    settled.createdAt = new Date(clock).toISOString();
    settled.expiresAt = deriveStudioProposalExpiresAtV4(settled.createdAt);
    await replay(sidecars, settled);
    await sidecars.rejectProposalV4({ projectId: settled.projectId, proposalId: settled.id });

    clock -= 31_000;
    const candidate = proposal('clock_rollback');
    candidate.createdAt = new Date(clock).toISOString();
    candidate.expiresAt = deriveStudioProposalExpiresAtV4(candidate.createdAt);
    await expect(replay(sidecars, candidate)).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'corrupt_storage',
    });
    await expect(readFile(path.join(root, 'project_1', 'proposal', 'current.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('preflights a rolled-back decision before publishing terminal intent', async () => {
    let clock = Date.parse(createdAt) + 60_000;
    const { root, sidecars } = await harness(() => new Date(clock).toISOString());
    const anchor = proposal('decision_anchor');
    anchor.createdAt = new Date(clock).toISOString();
    anchor.expiresAt = deriveStudioProposalExpiresAtV4(anchor.createdAt);
    await replay(sidecars, anchor);
    await sidecars.rejectProposalV4({ projectId: anchor.projectId, proposalId: anchor.id });

    clock += 1_000;
    const pending = proposal('decision_rollback');
    pending.createdAt = new Date(clock).toISOString();
    pending.expiresAt = deriveStudioProposalExpiresAtV4(pending.createdAt);
    await replay(sidecars, pending);
    clock -= 31_000;
    await expect(
      sidecars.rejectProposalV4({ projectId: pending.projectId, proposalId: pending.id })
    ).rejects.toMatchObject({ code: 'storage_error' });
    await expect(
      readFile(path.join(root, 'project_1', 'proposal', 'decided', `${pending.id}.json`))
    ).rejects.toMatchObject({ code: 'ENOENT' });

    clock += 32_000;
    await expect(sidecars.rejectProposalV4({ projectId: pending.projectId, proposalId: pending.id })).resolves.toEqual({
      status: 'rejected',
    });
  });
  it('preserves unsupported current-sidecar classification through read authority', async () => {
    const { root, sidecars } = await harness();
    const candidate = proposal('future_current');
    await replay(sidecars, candidate);
    const currentPath = path.join(root, 'project_1', 'proposal', 'current.json');
    const current = JSON.parse(await readFile(currentPath, 'utf8')) as Record<string, unknown>;
    current.schemaVersion = 2;
    await writeFile(currentPath, JSON.stringify(current), 'utf8');

    await expect(sidecars.getPendingProposalV4(candidate.projectId)).rejects.toMatchObject({
      name: 'CreativeStudioProposalSidecarErrorV4',
      code: 'unsupported_prototype_schema',
    });
    await expect(replay(sidecars, candidate)).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'corrupt_storage',
    });
  });
  it('preserves unsupported history-sidecar classification through read authority', async () => {
    const { root, sidecars } = await harness();
    const candidate = proposal('future_history');
    await replay(sidecars, candidate);
    await sidecars.rejectProposalV4({ projectId: candidate.projectId, proposalId: candidate.id });
    const historyPath = path.join(root, 'project_1', 'proposal', 'history.json');
    const history = JSON.parse(await readFile(historyPath, 'utf8')) as Record<string, unknown>;
    history.schemaVersion = 2;
    await writeFile(historyPath, JSON.stringify(history), 'utf8');

    await expect(sidecars.getProposalStateV4(candidate.projectId, candidate.id)).rejects.toMatchObject({
      name: 'CreativeStudioProposalSidecarErrorV4',
      code: 'unsupported_prototype_schema',
    });
    await expect(replay(sidecars, candidate)).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'corrupt_storage',
    });
  });
  it('rejects invalid and non-canonical current and history records as storage corruption', async () => {
    const invalidCurrent = await harness();
    const currentProposal = proposal('invalid_current_shape');
    await replay(invalidCurrent.sidecars, currentProposal);
    const currentPath = path.join(invalidCurrent.root, 'project_1', 'proposal', 'current.json');
    const current = JSON.parse(await readFile(currentPath, 'utf8')) as Record<string, unknown>;
    delete current.payloadSha256;
    await writeFile(currentPath, JSON.stringify(current), 'utf8');
    await expect(invalidCurrent.sidecars.getPendingProposalV4('project_1')).rejects.toMatchObject({
      code: 'storage_error',
    });

    const nonCanonicalCurrent = await harness();
    const formattedProposal = proposal('noncanonical_current');
    await replay(nonCanonicalCurrent.sidecars, formattedProposal);
    const formattedPath = path.join(nonCanonicalCurrent.root, 'project_1', 'proposal', 'current.json');
    const formatted = JSON.parse(await readFile(formattedPath, 'utf8'));
    await writeFile(formattedPath, JSON.stringify(formatted, null, 2), 'utf8');
    await expect(nonCanonicalCurrent.sidecars.getPendingProposalV4('project_1')).rejects.toMatchObject({
      code: 'storage_error',
    });

    const invalidHistory = await harness();
    const settled = proposal('invalid_history_shape');
    await replay(invalidHistory.sidecars, settled);
    await invalidHistory.sidecars.rejectProposalV4({ projectId: settled.projectId, proposalId: settled.id });
    const historyPath = path.join(invalidHistory.root, 'project_1', 'proposal', 'history.json');
    await writeFile(
      historyPath,
      JSON.stringify({ schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4, entries: 'not-an-array' }),
      'utf8'
    );
    await expect(invalidHistory.sidecars.getProposalStateV4('project_1', settled.id)).rejects.toMatchObject({
      code: 'storage_error',
    });
  });
  it('rejects an invalid decided envelope and a current/history identity disagreement', async () => {
    const invalidDecided = await harness();
    const decidedCandidate = proposal('invalid_decided_shape');
    await replay(invalidDecided.sidecars, decidedCandidate);
    await writeFile(
      path.join(invalidDecided.root, 'project_1', 'proposal', 'decided', `${decidedCandidate.id}.json`),
      JSON.stringify({ schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4 }),
      'utf8'
    );
    await expect(
      invalidDecided.sidecars.recoverProposalTerminalV4(decidedCandidate.projectId, decidedCandidate.id)
    ).rejects.toMatchObject({ code: 'storage_error' });

    const disagreement = await harness();
    const pending = proposal('history_disagreement');
    await replay(disagreement.sidecars, pending);
    const mismatchedHistory = {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
      entries: [
        {
          proposalId: pending.id,
          status: 'rejected',
          decidedAt: createdAt,
          payloadSha256: '0'.repeat(64),
          commandSha256: pending.source.commandSha256,
          appliedRevision: null,
          payloadRetained: false,
        },
      ],
    };
    await writeFile(
      path.join(disagreement.root, 'project_1', 'proposal', 'history.json'),
      JSON.stringify(mismatchedHistory),
      'utf8'
    );
    await expect(disagreement.sidecars.recoverProposalTerminalV4(pending.projectId, pending.id)).rejects.toMatchObject({
      code: 'storage_error',
    });
  });

  it('recovers an expiry whose terminal envelope became durable before its receipt', async () => {
    let clock = Date.parse(createdAt);
    const { root, store } = await harness(() => new Date(clock).toISOString());
    let interruptOnce = true;
    const crashing = createCreativeStudioProposalSidecarsV4({
      projectStore: store,
      now: () => new Date(clock).toISOString(),
      onStorageStep: (step) => {
        if (step === 'terminal_transaction_durable' && interruptOnce) {
          interruptOnce = false;
          throw new Error('simulated terminal receipt interruption');
        }
      },
    });
    const candidate = proposal('recover_expiry');
    await replay(crashing, candidate);
    clock = Date.parse(candidate.expiresAt);
    await expect(crashing.getPendingProposalV4(candidate.projectId)).rejects.toMatchObject({ code: 'storage_error' });

    let temporaryId = 0;
    const restartedStore = createCreativeStudioPilotStoreV4({
      rootDir: root,
      now: () => new Date(clock).toISOString(),
      createProjectId: () => 'unused',
      createTemporaryId: () => `expiry_restart_${String(++temporaryId).padStart(8, '0')}`,
      mainInstanceId: 'main_expiry_restart',
      hasSingleInstanceRecoveryAuthority: () => true,
    });
    const restarted = createCreativeStudioProposalSidecarsV4({
      projectStore: restartedStore,
      now: () => new Date(clock).toISOString(),
    });
    await expect(restarted.recoverProposalTerminalV4(candidate.projectId, candidate.id)).resolves.toEqual({
      status: 'expired',
    });
  });

  it('requires terminal payload bytes and their pending counterpart to agree exactly during recovery', async () => {
    let caseNumber = 0;
    const terminalResidue = async (commandId: string) => {
      const state = await harness();
      let interruptOnce = true;
      const crashing = createCreativeStudioProposalSidecarsV4({
        projectStore: state.store,
        now: () => createdAt,
        onStorageStep: (step) => {
          if (step === 'terminal_transaction_durable' && interruptOnce) {
            interruptOnce = false;
            throw new Error('simulated terminal interruption');
          }
        },
      });
      const candidate = proposal(commandId);
      await replay(crashing, candidate);
      await expect(
        crashing.rejectProposalV4({ projectId: candidate.projectId, proposalId: candidate.id })
      ).rejects.toMatchObject({ code: 'storage_error' });
      const restartedStore = createCreativeStudioPilotStoreV4({
        rootDir: state.root,
        now: () => createdAt,
        createProjectId: () => 'unused',
        createTemporaryId: () => `terminal_case_${++caseNumber}`,
        mainInstanceId: `main_terminal_case_${caseNumber}`,
        hasSingleInstanceRecoveryAuthority: () => true,
      });
      return {
        ...state,
        candidate,
        restarted: createCreativeStudioProposalSidecarsV4({ projectStore: restartedStore, now: () => createdAt }),
        currentPath: path.join(state.root, 'project_1', 'proposal', 'current.json'),
        decidedPath: path.join(state.root, 'project_1', 'proposal', 'decided', `${candidate.id}.json`),
      };
    };

    const nonCanonical = await terminalResidue('noncanonical_decided');
    const envelope = JSON.parse(await readFile(nonCanonical.decidedPath, 'utf8'));
    await writeFile(nonCanonical.decidedPath, JSON.stringify(envelope, null, 2), 'utf8');
    await expect(
      nonCanonical.restarted.recoverProposalTerminalV4('project_1', nonCanonical.candidate.id)
    ).rejects.toMatchObject({ code: 'storage_error' });

    const missingPending = await terminalResidue('missing_terminal_pending');
    await rm(missingPending.currentPath);
    await expect(
      missingPending.restarted.recoverProposalTerminalV4('project_1', missingPending.candidate.id)
    ).rejects.toMatchObject({ code: 'storage_error' });

    const differentPending = await terminalResidue('different_terminal_pending');
    const replacement = proposal('replacement_pending');
    const replacementBytes = JSON.stringify(replacement);
    await writeFile(
      differentPending.currentPath,
      JSON.stringify({
        schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
        proposalId: replacement.id,
        payloadSha256: createHash('sha256').update(replacementBytes).digest('hex'),
        admittedAt: replacement.createdAt,
        proposal: replacement,
      }),
      'utf8'
    );
    await expect(
      differentPending.restarted.recoverProposalTerminalV4('project_1', differentPending.candidate.id)
    ).rejects.toMatchObject({ code: 'storage_error' });
  });
  it('returns unavailable for corrupt exact-path storage', async () => {
    const { root, sidecars } = await harness();
    const p = proposal();
    await replay(sidecars, p);
    await rm(path.join(root, 'project_1', 'proposal', 'current.json'));
    await (await import('node:fs/promises')).writeFile(path.join(root, 'project_1', 'proposal', 'history.json'), '{');
    await expect(replay(sidecars, p)).resolves.toEqual({ outcome: 'unavailable', reason: 'corrupt_storage' });
  });
  it('does not erase settled authority when the decided directory is missing', async () => {
    const { root, sidecars } = await harness();
    const p = proposal();
    await replay(sidecars, p);
    await sidecars.rejectProposalV4({ projectId: p.projectId, proposalId: p.id });
    await rm(path.join(root, 'project_1', 'proposal', 'decided'), { recursive: true });
    await expect(replay(sidecars, p)).resolves.toEqual({ outcome: 'unavailable', reason: 'corrupt_storage' });
    await expect(readFile(path.join(root, 'project_1', 'proposal', 'current.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('lets settled history win while a different proposal occupies current', async () => {
    const { sidecars } = await harness();
    const settled = proposal('settled');
    const pending = proposal('pending');
    await replay(sidecars, settled);
    await sidecars.rejectProposalV4({ projectId: settled.projectId, proposalId: settled.id });
    await replay(sidecars, pending);
    await expect(replay(sidecars, settled)).resolves.toMatchObject({
      outcome: 'already_decided',
      proposalId: settled.id,
      status: 'rejected',
    });
    await expect(sidecars.getPendingProposalV4(pending.projectId)).resolves.toMatchObject({
      record: { id: pending.id },
    });
  });
  it('reserves exact terminal-history capacity before publishing current', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'proposal-history-capacity-'));
    roots.push(root);
    let n = 0;
    const store = createCreativeStudioPilotStoreV4({
      rootDir: root,
      now: () => createdAt,
      createProjectId: () => 'project_1',
      createTemporaryId: () => `capacity_${String(++n).padStart(8, '0')}`,
    });
    await store.createProjectV4({ name: 'Test', brief: 'Test' });
    const sidecars = createCreativeStudioProposalSidecarsV4({
      projectStore: store,
      now: () => createdAt,
      historyMaxBytes: 32,
    });
    const p = proposal();
    await expect(replay(sidecars, p)).resolves.toEqual({ outcome: 'refused', reason: 'history_capacity' });
    await expect(readFile(path.join(root, 'project_1', 'proposal', 'current.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('refuses a fresh proposal that exceeds the exact payload ceiling', async () => {
    const { root, sidecars } = await harness();
    const oversized = maximumSizedProposal();
    const extensible = oversized.payload.beats
      .flatMap((beat) => beat.shots)
      .find((shot) => shot.shootingScript.length < STUDIO_MAX_SHOOTING_SCRIPT_LENGTH);
    if (extensible === undefined) throw new Error('maximum-sized fixture has no extensible script');
    extensible.shootingScript += 'x';
    expect(Buffer.byteLength(JSON.stringify(oversized), 'utf8')).toBe(STUDIO_PROPOSAL_MAX_RECORD_BYTES_V4 + 1);
    await expect(replay(sidecars, oversized)).resolves.toEqual({
      outcome: 'refused',
      reason: 'proposal_too_large',
    });
    await expect(readFile(path.join(root, 'project_1', 'proposal', 'current.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('maps a valid proposal beyond the Board ceiling to capacity refusal', async () => {
    const { store, sidecars } = await harness();
    const accepted = proposal('capacity_template');
    await replay(sidecars, accepted);
    await sidecars.acceptProposalV4({ projectId: accepted.projectId, proposalId: accepted.id });
    const filled = await store.updateProjectV4(
      accepted.projectId,
      (project) => {
        const template = project.boards[accepted.target.boardId]!;
        const boardOrder = [...project.boardOrder];
        const boards = { ...project.boards };
        for (let index = 1; index < STUDIO_MAX_BOARDS_V4; index += 1) {
          const boardId = `board_capacity_filler_${index}`;
          const beatId = `beat_capacity_filler_${index}`;
          const shotId = `shot_capacity_filler_${index}`;
          const templateBeat = template.beats[template.beatOrder[0]!]!;
          const templateShot = template.shots[templateBeat.shotOrder[0]!]!;
          boards[boardId] = {
            ...template,
            id: boardId,
            handle: `board_capacity_filler_${index}`,
            beatOrder: [beatId],
            beats: { [beatId]: { ...templateBeat, id: beatId, shotOrder: [shotId] } },
            shots: { [shotId]: { ...templateShot, id: shotId } },
          };
          boardOrder.push(boardId);
        }
        return { ...project, boardOrder, boards };
      },
      { expectedRevision: 2, kind: 'authoring', committedAt: createdAt }
    );

    const beyond = proposal('beyond_board_capacity');
    beyond.baseAuthoringRevision = filled.authoringRevision;
    await expect(replay(sidecars, beyond)).resolves.toEqual({
      outcome: 'refused',
      reason: 'board_capacity_reached',
    });
  });

  it('reports the exact different proposal holding terminal writer authority', async () => {
    const { store } = await harness();
    const holding = proposal('terminal_holder');
    vi.spyOn(store, 'withProjectWriterAuthorityV4').mockRejectedValue(new CreativeStudioPilotStoreErrorV4('busy'));
    vi.spyOn(store, 'waitForLocalProjectWriterV4').mockResolvedValue(false);
    vi.spyOn(store, 'readProjectWriterIntentV4').mockResolvedValue({
      purpose: 'proposal_terminal',
      proposalId: holding.id,
    });
    const competing = createCreativeStudioProposalSidecarsV4({
      projectStore: store,
      now: () => createdAt,
    });
    const candidate = proposal('terminal_contender');
    await expect(replay(competing, candidate)).resolves.toEqual({
      outcome: 'busy',
      holdingProposalId: holding.id,
    });
  });
  it('bounds reclassification after a terminal writer retires without durable proposal state', async () => {
    const { store } = await harness();
    const candidate = proposal('retired_without_state');
    vi.spyOn(store, 'withProjectWriterAuthorityV4').mockRejectedValue(new CreativeStudioPilotStoreErrorV4('busy'));
    vi.spyOn(store, 'waitForLocalProjectWriterV4').mockResolvedValue(false);
    vi.spyOn(store, 'readProjectWriterIntentV4')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ purpose: 'proposal_terminal', proposalId: candidate.id });
    const sidecars = createCreativeStudioProposalSidecarsV4({ projectStore: store, now: () => createdAt });
    await expect(replay(sidecars, candidate)).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'corrupt_storage',
    });
    expect(store.withProjectWriterAuthorityV4).toHaveBeenCalledTimes(2);
  });

  it('refuses a proposal whose nested schema discriminator is unsupported', async () => {
    const { sidecars } = await harness();
    const unsupported = proposal('unsupported_record');
    unsupported.schemaVersion = 2 as never;
    await expect(replay(sidecars, unsupported)).resolves.toEqual({
      outcome: 'refused',
      reason: 'invalid_payload',
    });
  });
  it('reserves the larger post-prune false flag even when passive expiry is observed late', async () => {
    let clock = Date.parse(createdAt);
    const { root, store, sidecars } = await harness(() => new Date(clock).toISOString());
    const old = proposal('reservation_old');
    await replay(sidecars, old);
    await sidecars.rejectProposalV4({ projectId: old.projectId, proposalId: old.id });

    const candidate = proposal('reservation_flip');
    const history = JSON.parse(await readFile(path.join(root, 'project_1', 'proposal', 'history.json'), 'utf8'));
    const reserve = {
      proposalId: candidate.id,
      status: 'accepted',
      decidedAt: candidate.expiresAt,
      payloadSha256: createHash('sha256').update(JSON.stringify(candidate)).digest('hex'),
      commandSha256: candidate.source.commandSha256,
      appliedRevision: Number.MAX_SAFE_INTEGER,
      payloadRetained: true,
    };
    const unprunedBytes = Buffer.byteLength(
      JSON.stringify({ schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4, entries: [...history.entries, reserve] })
    );
    const bounded = createCreativeStudioProposalSidecarsV4({
      projectStore: store,
      now: () => new Date(clock).toISOString(),
      historyMaxBytes: unprunedBytes,
    });

    await expect(replay(bounded, candidate)).resolves.toEqual({ outcome: 'refused', reason: 'history_capacity' });
    await expect(readFile(path.join(root, 'project_1', 'proposal', 'current.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('prunes an unparseable retained payload using history as terminal authority', async () => {
    let clock = Date.parse(createdAt);
    const { root, sidecars } = await harness(() => new Date(clock).toISOString());
    const old = proposal('malformed_retained');
    await replay(sidecars, old);
    await sidecars.rejectProposalV4({ projectId: old.projectId, proposalId: old.id });
    const oldPayload = path.join(root, 'project_1', 'proposal', 'decided', `${old.id}.json`);
    await writeFile(oldPayload, '{');

    clock += 8 * 24 * 60 * 60 * 1_000;
    const current = proposal('prune_without_parse');
    current.createdAt = new Date(clock).toISOString();
    current.expiresAt = deriveStudioProposalExpiresAtV4(current.createdAt);
    await replay(sidecars, current);
    await expect(sidecars.rejectProposalV4({ projectId: current.projectId, proposalId: current.id })).resolves.toEqual({
      status: 'rejected',
    });
    await expect(readFile(oldPayload)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(replay(sidecars, old)).resolves.toMatchObject({ outcome: 'already_decided', status: 'rejected' });
  });
  it('maps handle and persistent-identity feasibility failures distinctly', async () => {
    const { sidecars } = await harness();
    const accepted = proposal('feasibility_anchor');
    await replay(sidecars, accepted);
    await sidecars.acceptProposalV4({ projectId: accepted.projectId, proposalId: accepted.id });

    const handleCollision = proposal('feasibility_handle');
    handleCollision.baseAuthoringRevision = 2;
    handleCollision.payload.handle = accepted.payload.handle;
    await expect(replay(sidecars, handleCollision)).resolves.toEqual({
      outcome: 'refused',
      reason: 'handle_collision',
    });

    const identityCollision = proposal('feasibility_identity');
    identityCollision.baseAuthoringRevision = 2;
    identityCollision.target.boardId = accepted.target.boardId;
    await expect(replay(sidecars, identityCollision)).resolves.toEqual({
      outcome: 'refused',
      reason: 'identity_collision',
    });
  });
  it('keeps permanent tombstones while bounding retained payloads by count and age', async () => {
    let clock = Date.parse(createdAt);
    const { root, sidecars } = await harness(() => new Date(clock).toISOString());
    let oldest: StudioProposalRecordV4 | null = null;
    for (let index = 0; index < 33; index += 1) {
      const p = proposal(`retention_${index}`);
      oldest ??= structuredClone(p);
      p.createdAt = new Date(clock).toISOString();
      p.expiresAt = deriveStudioProposalExpiresAtV4(p.createdAt);
      await replay(sidecars, p);
      await sidecars.rejectProposalV4({ projectId: p.projectId, proposalId: p.id });
      clock += 60_000;
    }
    const directory = path.join(root, 'project_1', 'proposal', 'decided');
    expect(await readdir(directory)).toHaveLength(32);
    let history = JSON.parse(await readFile(path.join(root, 'project_1', 'proposal', 'history.json'), 'utf8'));
    expect(history.entries).toHaveLength(33);
    expect(history.entries.filter((entry: { payloadRetained: boolean }) => entry.payloadRetained)).toHaveLength(32);
    clock += 8 * 24 * 60 * 60 * 1_000;
    const final = proposal('retention_final');
    final.createdAt = new Date(clock).toISOString();
    final.expiresAt = deriveStudioProposalExpiresAtV4(final.createdAt);
    await replay(sidecars, final);
    await sidecars.rejectProposalV4({ projectId: final.projectId, proposalId: final.id });
    history = JSON.parse(await readFile(path.join(root, 'project_1', 'proposal', 'history.json'), 'utf8'));
    expect(history.entries).toHaveLength(34);
    expect(history.entries.filter((entry: { payloadRetained: boolean }) => entry.payloadRetained)).toHaveLength(1);
    await expect(replay(sidecars, oldest!)).resolves.toMatchObject({
      outcome: 'already_decided',
      status: 'rejected',
    });
    const changed = structuredClone(oldest!);
    changed.payload.handle = 'changed_after_prune';
    await expect(replay(sidecars, changed)).resolves.toMatchObject({
      outcome: 'identity_collision',
      proposalId: oldest!.id,
    });
  }, 60_000);
});
