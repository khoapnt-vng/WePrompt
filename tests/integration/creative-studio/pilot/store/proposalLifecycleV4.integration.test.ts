/** @vitest-environment node */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  deriveStudioProposalExpiresAtV4,
  deriveStudioProposalIdV4,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  type StudioProposalRecordV4,
} from '@process/services/creative-studio/service/schema2/proposals/proposalContractsV4';
import {
  createCreativeStudioPilotStoreV4,
  createCreativeStudioProposalSidecarsV4,
  type StudioProposalSidecarStorageStepV4,
} from '@process/services/creative-studio/store/pilot';
import { afterEach, describe, expect, it } from 'vitest';
const roots: string[] = [];
afterEach(() => Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))));
const at = '2026-09-02T01:00:00.000Z';
const id = deriveStudioProposalIdV4('project_1', 'command_1');
const proposal = (commandId = 'command_1'): StudioProposalRecordV4 => {
  const suffix = commandId === 'command_1' ? '1' : commandId;
  return {
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
    target: { kind: 'board', boardId: `board_${suffix}` },
    issuedMemberIds: { beatIds: [`beat_${suffix}`], shotIds: [`shot_${suffix}`] },
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
    createdAt: at,
    expiresAt: deriveStudioProposalExpiresAtV4(at),
    decidedAt: null,
  };
};
const store = (root: string, recovery = false) => {
  let n = 0;
  return createCreativeStudioPilotStoreV4({
    rootDir: root,
    now: () => at,
    createProjectId: () => 'project_1',
    createTemporaryId: () => `temp_${String(++n).padStart(8, '0')}`,
    mainInstanceId: recovery ? 'recovery1' : 'original1',
    hasSingleInstanceRecoveryAuthority: () => recovery,
  });
};
describe('proposal terminal crash recovery', () => {
  it('replay recovers a durable rejection and returns its terminal result', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'proposal-replay-reject-crash-'));
    roots.push(root);
    const firstStore = store(root);
    await firstStore.createProjectV4({ name: 'Test', brief: 'Test' });
    let crashed = false;
    const first = createCreativeStudioProposalSidecarsV4({
      projectStore: firstStore,
      now: () => at,
      onStorageStep: (step) => {
        if (!crashed && step === 'terminal_transaction_durable') {
          crashed = true;
          throw new Error('crash');
        }
      },
    });
    const candidate = proposal();
    await first.replayProposalV4({
      projectId: candidate.projectId,
      proposalId: candidate.id,
      proposal: candidate,
    });
    await expect(
      first.rejectProposalV4({ projectId: candidate.projectId, proposalId: candidate.id })
    ).rejects.toMatchObject({ code: 'storage_error' });

    const recoveringStore = store(root, true);
    const recovering = createCreativeStudioProposalSidecarsV4({ projectStore: recoveringStore, now: () => at });
    await expect(
      recovering.replayProposalV4({
        projectId: candidate.projectId,
        proposalId: candidate.id,
        proposal: candidate,
      })
    ).resolves.toMatchObject({
      outcome: 'already_decided',
      proposalId: candidate.id,
      status: 'rejected',
      appliedRevision: null,
    });
    await expect(recovering.getPendingProposalV4(candidate.projectId)).resolves.toBeNull();
    await expect(recoveringStore.loadProjectV4(candidate.projectId)).resolves.toMatchObject({
      revision: 1,
      boardOrder: [],
    });
  });

  it('replay recovers a durable acceptance and applies its Board exactly once', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'proposal-replay-accept-crash-'));
    roots.push(root);
    const firstStore = store(root);
    await firstStore.createProjectV4({ name: 'Test', brief: 'Test' });
    let crashed = false;
    const first = createCreativeStudioProposalSidecarsV4({
      projectStore: firstStore,
      now: () => at,
      onStorageStep: (step) => {
        if (!crashed && step === 'terminal_transaction_durable') {
          crashed = true;
          throw new Error('crash');
        }
      },
    });
    const candidate = proposal();
    await first.replayProposalV4({
      projectId: candidate.projectId,
      proposalId: candidate.id,
      proposal: candidate,
    });
    await expect(
      first.acceptProposalV4({ projectId: candidate.projectId, proposalId: candidate.id })
    ).rejects.toMatchObject({ code: 'storage_error' });

    const recoveringStore = store(root, true);
    const recovering = createCreativeStudioProposalSidecarsV4({ projectStore: recoveringStore, now: () => at });
    const replayInput = {
      projectId: candidate.projectId,
      proposalId: candidate.id,
      proposal: candidate,
    };
    await expect(recovering.replayProposalV4(replayInput)).resolves.toMatchObject({
      outcome: 'already_decided',
      proposalId: candidate.id,
      status: 'accepted',
      appliedRevision: 2,
    });
    await expect(recovering.replayProposalV4(replayInput)).resolves.toMatchObject({
      outcome: 'already_decided',
      proposalId: candidate.id,
      status: 'accepted',
      appliedRevision: 2,
    });
    await expect(recoveringStore.loadProjectV4(candidate.projectId)).resolves.toMatchObject({
      revision: 2,
      authoringRevision: 2,
      boardOrder: ['board_1'],
      boards: { board_1: { id: 'board_1' } },
    });
  });

  it('waits for a failing local terminal writer, then recovers its durable decision on replay', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'proposal-replay-local-terminal-crash-'));
    roots.push(root);
    let temporaryId = 0;
    const firstStore = createCreativeStudioPilotStoreV4({
      rootDir: root,
      now: () => at,
      createProjectId: () => 'project_1',
      createTemporaryId: () => `local_${String(++temporaryId).padStart(8, '0')}`,
      mainInstanceId: 'main_instance_local',
      hasSingleInstanceRecoveryAuthority: () => true,
    });
    await firstStore.createProjectV4({ name: 'Test', brief: 'Test' });
    let announceTerminalDurable!: () => void;
    let releaseTerminalWriter!: () => void;
    const terminalDurable = new Promise<void>((resolve) => {
      announceTerminalDurable = resolve;
    });
    const terminalWriterReleased = new Promise<void>((resolve) => {
      releaseTerminalWriter = resolve;
    });
    let interruptOnce = true;
    const first = createCreativeStudioProposalSidecarsV4({
      projectStore: firstStore,
      now: () => at,
      onStorageStep: async (step) => {
        if (!interruptOnce || step !== 'terminal_transaction_durable') return;
        announceTerminalDurable();
        await terminalWriterReleased;
        interruptOnce = false;
        throw new Error('simulated local terminal writer death');
      },
    });
    const candidate = proposal();
    const replayInput = { projectId: candidate.projectId, proposalId: candidate.id, proposal: candidate };
    await expect(first.replayProposalV4(replayInput)).resolves.toMatchObject({ outcome: 'admitted' });
    const rejection = first.rejectProposalV4({ projectId: candidate.projectId, proposalId: candidate.id });
    await terminalDurable;

    const secondStore = createCreativeStudioPilotStoreV4({
      rootDir: root,
      now: () => at,
      createProjectId: () => 'unused_project',
      createTemporaryId: () => `observer_${String(++temporaryId).padStart(8, '0')}`,
      mainInstanceId: 'main_instance_local',
      hasSingleInstanceRecoveryAuthority: () => true,
    });
    const second = createCreativeStudioProposalSidecarsV4({ projectStore: secondStore, now: () => at });
    let replaySettled = false;
    const replayed = second.replayProposalV4(replayInput).finally(() => {
      replaySettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(replaySettled).toBe(false);

    releaseTerminalWriter();
    await expect(rejection).rejects.toMatchObject({ code: 'storage_error' });
    await expect(replayed).resolves.toMatchObject({
      outcome: 'already_decided',
      proposalId: candidate.id,
      status: 'rejected',
      appliedRevision: null,
    });
    await expect(second.getPendingProposalV4(candidate.projectId)).resolves.toBeNull();
  });

  it.each(['terminal_transaction_durable', 'history_durable', 'pending_released'] as const)(
    'recovers rejection interrupted after %s without deciding twice',
    async (crashAt) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'proposal-crash-'));
      roots.push(root);
      const firstStore = store(root);
      await firstStore.createProjectV4({ name: 'Test', brief: 'Test' });
      let crashed = false;
      const first = createCreativeStudioProposalSidecarsV4({
        projectStore: firstStore,
        now: () => at,
        onStorageStep: (step: StudioProposalSidecarStorageStepV4) => {
          if (!crashed && step === crashAt) {
            crashed = true;
            throw new Error('crash');
          }
        },
      });
      const p = proposal();
      await expect(
        first.replayProposalV4({ projectId: p.projectId, proposalId: p.id, proposal: p })
      ).resolves.toMatchObject({ outcome: 'admitted' });
      await expect(first.rejectProposalV4({ projectId: p.projectId, proposalId: p.id })).rejects.toThrow();
      const recoveringStore = store(root, true);
      const recovering = createCreativeStudioProposalSidecarsV4({ projectStore: recoveringStore, now: () => at });
      await expect(recovering.recoverProposalTerminalV4('project_1', id)).resolves.toMatchObject({
        status: 'rejected',
      });
      const history = JSON.parse(await readFile(path.join(root, 'project_1', 'proposal', 'history.json'), 'utf8'));
      expect(history.entries.filter((entry: { proposalId: string }) => entry.proposalId === id)).toHaveLength(1);
      await expect(recovering.getPendingProposalV4('project_1')).resolves.toBeNull();
    }
  );
  it.each(['terminal_transaction_durable', 'project_committed'] as const)(
    'recovers acceptance interrupted after %s and applies the Board exactly once',
    async (crashAt) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'proposal-accept-crash-'));
      roots.push(root);
      const firstStore = store(root);
      await firstStore.createProjectV4({ name: 'Test', brief: 'Test' });
      let crashed = false;
      const first = createCreativeStudioProposalSidecarsV4({
        projectStore: firstStore,
        now: () => at,
        onStorageStep: (step) => {
          if (!crashed && step === crashAt) {
            crashed = true;
            throw new Error('crash');
          }
        },
      });
      const p = proposal();
      await first.replayProposalV4({ projectId: p.projectId, proposalId: p.id, proposal: p });
      await expect(first.acceptProposalV4({ projectId: p.projectId, proposalId: p.id })).rejects.toThrow();
      const recoveringStore = store(root, true);
      const recovering = createCreativeStudioProposalSidecarsV4({ projectStore: recoveringStore, now: () => at });
      await expect(recovering.recoverProposalTerminalV4('project_1', id)).resolves.toMatchObject({
        status: 'already_accepted',
        appliedRevision: 2,
      });
      const project = await recoveringStore.loadProjectV4('project_1');
      expect(project?.boardOrder).toEqual(['board_1']);
    }
  );

  it('recovers acceptance after the terminal envelope commits before the project journal exists', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'proposal-accept-authority-crash-'));
    roots.push(root);
    let crashed = false;
    const firstStore = createCreativeStudioPilotStoreV4({
      rootDir: root,
      now: () => at,
      createProjectId: () => 'project_1',
      createTemporaryId: (() => {
        let n = 0;
        return () => `temp_${String(++n).padStart(8, '0')}`;
      })(),
      mainInstanceId: 'original1',
      hasSingleInstanceRecoveryAuthority: () => false,
      onStorageStep: (step) => {
        if (!crashed && step === 'update:authority_committed') {
          crashed = true;
          throw new Error('simulated death before project journal publication');
        }
      },
    });
    await firstStore.createProjectV4({ name: 'Test', brief: 'Test' });
    const first = createCreativeStudioProposalSidecarsV4({ projectStore: firstStore, now: () => at });
    const candidate = proposal();
    await first.replayProposalV4({
      projectId: candidate.projectId,
      proposalId: candidate.id,
      proposal: candidate,
    });
    await expect(
      first.acceptProposalV4({ projectId: candidate.projectId, proposalId: candidate.id })
    ).rejects.toMatchObject({ code: 'storage_error' });

    const recoveringStore = store(root, true);
    const recovering = createCreativeStudioProposalSidecarsV4({ projectStore: recoveringStore, now: () => at });
    await expect(recovering.recoverProposalTerminalV4('project_1', id)).resolves.toMatchObject({
      status: 'already_accepted',
      appliedRevision: 2,
    });
    await expect(recoveringStore.loadProjectV4('project_1')).resolves.toMatchObject({
      revision: 2,
      boardOrder: ['board_1'],
    });
  });

  it('repairs a crash between payload unlink and the retained-payload flag update', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'proposal-prune-crash-'));
    roots.push(root);
    let clock = Date.parse(at);
    const firstStore = createCreativeStudioPilotStoreV4({
      rootDir: root,
      now: () => new Date(clock).toISOString(),
      createProjectId: () => 'project_1',
      createTemporaryId: (() => {
        let n = 0;
        return () => `temp_${String(++n).padStart(8, '0')}`;
      })(),
      mainInstanceId: 'original1',
      hasSingleInstanceRecoveryAuthority: () => false,
    });
    await firstStore.createProjectV4({ name: 'Test', brief: 'Test' });
    let crashPrune = false;
    const first = createCreativeStudioProposalSidecarsV4({
      projectStore: firstStore,
      now: () => new Date(clock).toISOString(),
      onStorageStep: (step) => {
        if (crashPrune && step === 'payload_pruned') throw new Error('crash after unlink');
      },
    });
    let firstProposalId = '';
    let interruptedProposalId = '';
    for (let index = 0; index < 33; index += 1) {
      const candidate = proposal(`prune_${index}`);
      candidate.createdAt = new Date(clock).toISOString();
      candidate.expiresAt = deriveStudioProposalExpiresAtV4(candidate.createdAt);
      firstProposalId ||= candidate.id;
      interruptedProposalId = candidate.id;
      await first.replayProposalV4({ projectId: candidate.projectId, proposalId: candidate.id, proposal: candidate });
      crashPrune = index === 32;
      const decision = first.rejectProposalV4({ projectId: candidate.projectId, proposalId: candidate.id });
      if (crashPrune) await expect(decision).rejects.toMatchObject({ code: 'storage_error' });
      else await decision;
      clock += 60_000;
    }

    const recoveringStore = createCreativeStudioPilotStoreV4({
      rootDir: root,
      now: () => new Date(clock).toISOString(),
      createProjectId: () => 'unused',
      createTemporaryId: () => 'recovery_temp',
      mainInstanceId: 'recovery1',
      hasSingleInstanceRecoveryAuthority: () => true,
    });
    const recovering = createCreativeStudioProposalSidecarsV4({
      projectStore: recoveringStore,
      now: () => new Date(clock).toISOString(),
    });
    await expect(recovering.recoverProposalTerminalV4('project_1', interruptedProposalId)).resolves.toMatchObject({
      status: 'rejected',
    });
    const history = JSON.parse(await readFile(path.join(root, 'project_1', 'proposal', 'history.json'), 'utf8'));
    expect(history.entries.find((entry: { proposalId: string }) => entry.proposalId === firstProposalId)).toMatchObject(
      {
        payloadRetained: false,
      }
    );
    await expect(
      readFile(path.join(root, 'project_1', 'proposal', 'decided', `${firstProposalId}.json`))
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(recovering.getPendingProposalV4('project_1')).resolves.toBeNull();
  }, 60_000);
});
