/** @vitest-environment node */
import { promises as nodeFs } from 'node:fs';
import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createCreativeStudioPilotStoreV4,
  createCreativeStudioProposalLedgerV4,
} from '@process/services/creative-studio/store/pilot';
import { STUDIO_PROPOSAL_CURRENT_RECORD_MAX_BYTES_V4 } from '@process/services/creative-studio/service/schema2/proposals/proposalContractsV4';
import { afterEach, describe, expect, it, vi } from 'vitest';
const roots: string[] = [];
const proposalId = `proposal_${'a'.repeat(64)}`;
const secondProposalId = `proposal_${'b'.repeat(64)}`;
const noopOperation = async () => undefined;
afterEach(() => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));
const harness = async (fs = nodeFs) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'proposal-ledger-v4-'));
  roots.push(root);
  let n = 0;
  const projectStore = createCreativeStudioPilotStoreV4({
    rootDir: root,
    fs,
    now: () => '2026-09-02T00:00:00.000Z',
    createProjectId: () => 'project_1',
    createTemporaryId: () => `temp_${String(++n).padStart(8, '0')}`,
  });
  await projectStore.createProjectV4({ name: 'Test', brief: 'Test' });
  const ledger = createCreativeStudioProposalLedgerV4({
    projectStore,
    fs,
  });
  return { root, ledger };
};
describe('schema-7 exact-path proposal ledger', () => {
  it('rejects invalid authority arguments before entering project storage', async () => {
    const { ledger } = await harness();

    await expect(ledger.withProposalLedgerAuthorityV4('../escape', noopOperation)).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(ledger.withProposalLedgerAuthorityV4('project_1', null as never)).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(ledger.withProposalTerminalAuthorityV4('project_1', '../escape', noopOperation)).rejects.toMatchObject(
      {
        code: 'invalid_payload',
      }
    );
    await expect(ledger.withProposalTerminalAuthorityV4('project_1', proposalId, null as never)).rejects.toMatchObject({
      code: 'invalid_payload',
    });
  });
  it('rejects non-text, oversized, and non-Unicode publication bytes', async () => {
    const { ledger } = await harness();
    await ledger.withProposalLedgerAuthorityV4('project_1', async (a) => {
      await expect(a.publishCurrentV4(null as never)).rejects.toMatchObject({ code: 'invalid_payload' });
      await expect(
        a.publishCurrentV4('x'.repeat(STUDIO_PROPOSAL_CURRENT_RECORD_MAX_BYTES_V4 + 1))
      ).rejects.toMatchObject({ code: 'invalid_payload' });
      await expect(a.publishCurrentV4('\ud800')).rejects.toMatchObject({ code: 'invalid_payload' });
      expect(await a.readCurrentV4()).toBeNull();
    });
  });
  it('does not create storage on exact-path misses', async () => {
    const { root, ledger } = await harness();
    await ledger.withProposalLedgerAuthorityV4('project_1', async (a) => {
      expect(await a.readCurrentV4()).toBeNull();
      expect((await a.readHistoryV4()).record).toBeNull();
      expect(await a.readDecidedV4(proposalId)).toBeNull();
    });
    await expect(readdir(path.join(root, 'project_1', 'proposal'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('treats an empty exact family as missing without creating its decided directory', async () => {
    const { root, ledger } = await harness();
    const proposalRoot = path.join(root, 'project_1', 'proposal');
    await nodeFs.mkdir(proposalRoot);

    await ledger.withProposalLedgerAuthorityV4('project_1', async (a) => {
      expect(await a.readCurrentV4()).toBeNull();
      expect((await a.readHistoryV4()).record).toBeNull();
      expect(await a.readDecidedV4(proposalId)).toBeNull();
    });
    expect(await readdir(proposalRoot)).toEqual([]);
  });
  it('refuses a partial family whose decided directory is missing beside a live exact record', async () => {
    const { root, ledger } = await harness();
    const proposalRoot = path.join(root, 'project_1', 'proposal');
    await nodeFs.mkdir(proposalRoot);
    await writeFile(path.join(proposalRoot, 'current.json'), 'orphaned');

    await expect(ledger.withProposalLedgerAuthorityV4('project_1', (a) => a.readCurrentV4())).rejects.toMatchObject({
      code: 'storage_error',
    });
  });
  it('publishes only current, history, and exact decided paths', async () => {
    const { root, ledger } = await harness();
    await ledger.withProposalLedgerAuthorityV4('project_1', async (a) => {
      const current = await a.publishCurrentV4('{"current":true}');
      const history = await a.replaceHistoryV4({ record: null }, '{"history":true}');
      await a.publishDecidedV4(proposalId, '{"decided":true}');
      expect((await a.confirmCurrentV4())?.bytes).toBe(current.bytes);
      expect((await a.readHistoryV4()).record?.bytes).toBe(history.bytes);
    });
    expect((await readdir(path.join(root, 'project_1', 'proposal'))).toSorted()).toEqual([
      'current.json',
      'decided',
      'history.json',
    ]);
    expect(await readdir(path.join(root, 'project_1', 'proposal', 'decided'))).toEqual([`${proposalId}.json`]);
  });
  it('never enumerates the proposal family across publish, read, replace, and removal', async () => {
    const fs = { ...nodeFs };
    const readDirectory = vi.spyOn(fs, 'readdir');
    const openDirectory = vi.spyOn(fs, 'opendir');
    const { root, ledger } = await harness(fs);
    readDirectory.mockClear();
    openDirectory.mockClear();
    await ledger.withProposalTerminalAuthorityV4('project_1', proposalId, async (a) => {
      const current = await a.publishCurrentV4('{"current":true}');
      const history = await a.replaceHistoryV4({ record: null }, '{"history":true}');
      const decided = await a.publishDecidedV4(proposalId, '{"decided":true}');
      await a.confirmCurrentV4();
      await a.readHistoryV4();
      await a.confirmDecidedV4(proposalId);
      await a.replaceHistoryV4({ record: history }, '{"history":false}');
      await a.removeDecidedV4(proposalId, decided);
      await a.removeCurrentV4(current);
    });
    const proposalRoot = path.join(root, 'project_1', 'proposal');
    const targetsProposalFamily = ([target]: readonly unknown[]): boolean =>
      typeof target === 'string' && (target === proposalRoot || target.startsWith(`${proposalRoot}${path.sep}`));
    expect(readDirectory.mock.calls.filter(targetsProposalFamily)).toEqual([]);
    expect(openDirectory.mock.calls.filter(targetsProposalFamily)).toEqual([]);
  });
  it('keeps current exclusive and history replacement compare-and-swap', async () => {
    const { ledger } = await harness();
    await ledger.withProposalLedgerAuthorityV4('project_1', async (a) => {
      const current = await a.publishCurrentV4('one');
      await expect(a.publishCurrentV4('two')).rejects.toMatchObject({ code: 'already_exists' });
      const first = await a.replaceHistoryV4({ record: null }, 'one');
      await expect(a.replaceHistoryV4({ record: null }, 'two')).rejects.toMatchObject({ code: 'storage_error' });
      expect((await a.replaceHistoryV4({ record: first }, 'two')).bytes).toBe('two');
      await a.removeCurrentV4(current);
      expect(await a.readCurrentV4()).toBeNull();
    });
  });
  it('confirms exact misses after the family exists and refuses stale removal evidence', async () => {
    const { ledger } = await harness();
    await ledger.withProposalLedgerAuthorityV4('project_1', async (a) => {
      await a.replaceHistoryV4({ record: null }, 'history');
      expect(await a.confirmCurrentV4()).toBeNull();
      expect(await a.confirmDecidedV4(proposalId)).toBeNull();

      const current = await a.publishCurrentV4('current');
      await expect(a.removeCurrentV4({ ...current, bytes: 'other' })).rejects.toMatchObject({ code: 'storage_error' });
      await expect(
        a.removeCurrentV4({ ...current, identity: { ...current.identity, ino: current.identity.ino + 1 } })
      ).rejects.toMatchObject({ code: 'storage_error' });
      await a.removeCurrentV4(current);
    });
  });
  it('removes the one exact interrupted current-publication residue before retrying', async () => {
    const { root, ledger } = await harness();
    const residue = path.join(root, 'project_1', 'proposal', 'current.json.proposal_publish_v1.tmp');
    await ledger.withProposalLedgerAuthorityV4('project_1', async (a) => {
      await a.replaceHistoryV4({ record: null }, 'history');
      await writeFile(residue, 'abandoned');
      expect((await a.publishCurrentV4('current')).bytes).toBe('current');
    });
    await expect(nodeFs.lstat(residue)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('reconciles the one exact history residue without weakening CAS', async () => {
    const { root, ledger } = await harness();
    await ledger.withProposalLedgerAuthorityV4('project_1', async (a) => {
      const first = await a.replaceHistoryV4({ record: null }, 'one');
      await writeFile(path.join(root, 'project_1', 'proposal', 'history.json.tmp'), 'abandoned');
      const second = await a.replaceHistoryV4({ record: first }, 'two');
      expect(second.bytes).toBe('two');
      await expect(a.replaceHistoryV4({ record: first }, 'three')).rejects.toMatchObject({ code: 'storage_error' });
    });
    expect(await readdir(path.join(root, 'project_1', 'proposal'))).not.toContain('history.json.tmp');
  });
  it('accepts canonical proposal ids but rejects unsafe paths', async () => {
    const { ledger } = await harness();
    await ledger.withProposalLedgerAuthorityV4('project_1', async (a) => {
      await a.publishDecidedV4(proposalId, 'ok');
      expect((await a.readDecidedV4(proposalId))?.bytes).toBe('ok');
      await expect(a.readDecidedV4('../escape')).rejects.toMatchObject({ code: 'invalid_payload' });
    });
  });
  it('holds the project writer gate across independent stores', async () => {
    const { root, ledger } = await harness();
    let n = 100;
    const secondStore = createCreativeStudioPilotStoreV4({
      rootDir: root,
      now: () => '2026-09-02T00:00:00.000Z',
      createProjectId: () => 'unused',
      createTemporaryId: () => `other_${++n}`,
    });
    const second = createCreativeStudioProposalLedgerV4({ projectStore: secondStore });
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = ledger.withProposalTerminalAuthorityV4('project_1', proposalId, async () => {
      entered();
      await paused;
    });
    await ready;
    await expect(
      second.withProposalTerminalAuthorityV4('project_1', secondProposalId, async () => undefined)
    ).rejects.toMatchObject({ code: 'busy' });
    release();
    await first;
  });
  it('fails closed on a symlinked exact record without touching its target', async () => {
    const { root, ledger } = await harness();
    await ledger.withProposalLedgerAuthorityV4('project_1', (a) => a.publishCurrentV4('safe'));
    const current = path.join(root, 'project_1', 'proposal', 'current.json');
    const outside = path.join(root, 'outside.json');
    await rm(current);
    await writeFile(outside, 'outside');
    await symlink(outside, current);
    await expect(ledger.withProposalLedgerAuthorityV4('project_1', (a) => a.readCurrentV4())).rejects.toMatchObject({
      code: 'storage_error',
    });
    expect(await (await import('node:fs/promises')).readFile(outside, 'utf8')).toBe('outside');
  });
});
