/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { promises as nodeFs } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { StudioProjectWriterGateErrorV4 } from '@process/services/creative-studio/store/pilot';
import {
  createStudioProjectWriterGateV4,
  type StudioProjectWriterGateStepV4,
} from '@process/services/creative-studio/store/pilot';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-project-writer-gate-'));
  const canonicalRoot = await realpath(root);
  roots.push(canonicalRoot);
  return canonicalRoot;
};

const lockPath = (root: string, projectId: string): string => path.join(root, `.project-write-${projectId}.lock`);

const ownerBytes = (
  projectId: string,
  operationId = 'operation_old_01',
  purpose: 'project_update' | 'proposal_terminal' = 'project_update'
): string =>
  JSON.stringify({
    schemaVersion: 1,
    projectId,
    operationId,
    mainInstanceId: 'main_instance_old',
    purpose,
    proposalId: purpose === 'proposal_terminal' ? 'proposal_1' : null,
  });

const createCompleteLock = async (
  root: string,
  projectId: string,
  operationId = 'operation_old_01',
  purpose: 'project_update' | 'proposal_terminal' = 'project_update'
): Promise<string> => {
  const lock = lockPath(root, projectId);
  await mkdir(lock, { mode: 0o700 });
  await writeFile(path.join(lock, 'owner.json'), ownerBytes(projectId, operationId, purpose), { mode: 0o600 });
  await mkdir(path.join(lock, 'ready'), { mode: 0o700 });
  return lock;
};

const expectGateError = async (
  promise: Promise<unknown>,
  code: StudioProjectWriterGateErrorV4['code']
): Promise<void> => {
  await expect(promise).rejects.toMatchObject({ name: 'StudioProjectWriterGateErrorV4', code });
};

const abandonProjectGate = async (root: string, projectId: string, operationId = 'operation_old_01'): Promise<void> => {
  const gate = createStudioProjectWriterGateV4({
    mainInstanceId: 'main_instance_old',
    createOperationId: () => operationId,
  });
  await expect(
    gate.withWriter(root, projectId, { purpose: 'project_update' }, async (lease) => {
      lease.retainForRecovery();
      throw new Error('simulated process death');
    })
  ).rejects.toThrow('simulated process death');
};

describe('schema-7 durable project writer gate', () => {
  it('uses the canonical lock directory as reservation and invokes only after owner.json and ready are complete', async () => {
    const root = await temporaryRoot();
    const steps: StudioProjectWriterGateStepV4[] = [];
    const projectId = 'project_1';
    const lock = lockPath(root, projectId);
    const gate = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_01',
      createOperationId: () => 'operation_000001',
      onStep: (step) => steps.push(step),
    });

    await gate.withWriter(root, projectId, { purpose: 'project_update' }, async (lease) => {
      expect(steps).toEqual(['owner_durable', 'gate_published', 'root_durable']);
      expect((await lstat(lock)).isDirectory()).toBe(true);
      expect((await lstat(lock)).mode & 0o777).toBe(0o700);
      expect((await lstat(path.join(lock, 'owner.json'))).mode & 0o777).toBe(0o600);
      expect(await readdir(lock)).toEqual(['owner.json', 'ready']);
      expect(await readdir(path.join(lock, 'ready'))).toEqual([]);
      expect(JSON.parse(await readFile(path.join(lock, 'owner.json'), 'utf8'))).toEqual({
        schemaVersion: 1,
        projectId,
        operationId: 'operation_000001',
        mainInstanceId: 'main_instance_01',
        purpose: 'project_update',
        proposalId: null,
      });
      await lease.assertOwned();
    });

    expect(await readdir(root)).toEqual([]);
    expect(steps.slice(-3)).toEqual(['retired', 'retirement_durable', 'retired_residue_removed']);
  });

  it('round-trips proposal-terminal intent and lets observers await the complete local writer lifetime', async () => {
    const root = await temporaryRoot();
    const projectId = 'project_1';
    let announceWriter!: () => void;
    let releaseWriter!: () => void;
    const writerEntered = new Promise<void>((resolve) => {
      announceWriter = resolve;
    });
    const writerReleased = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const gate = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_01',
      createOperationId: () => 'operation_terminal_01',
    });

    const writerRun = gate.withWriter(
      root,
      projectId,
      { purpose: 'proposal_terminal', proposalId: 'proposal_1' },
      async () => {
        announceWriter();
        await writerReleased;
      }
    );
    await writerEntered;
    await expect(gate.readIntent(root, projectId)).resolves.toEqual({
      purpose: 'proposal_terminal',
      proposalId: 'proposal_1',
    });

    let observerSettled = false;
    const observer = gate.waitForLocalWriter(root, projectId).finally(() => {
      observerSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(observerSettled).toBe(false);

    releaseWriter();
    await expect(writerRun).resolves.toBeUndefined();
    await expect(observer).resolves.toBe(true);
    await expect(gate.waitForLocalWriter(root, projectId)).resolves.toBe(false);
    await expect(gate.assertUnlocked(root, projectId)).resolves.toBeUndefined();
  });

  it('rejects malformed factory and public-operation inputs before granting writer authority', async () => {
    const root = await temporaryRoot();
    expect(() => createStudioProjectWriterGateV4({ mainInstanceId: 'short' })).toThrow(
      'Invalid Studio Main instance id'
    );

    const gate = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_01',
      createOperationId: () => 'bad',
    });
    await expectGateError(
      gate.withWriter(root, 'project_1', { purpose: 'project_update' }, async () => undefined),
      'storage_error'
    );
    await expectGateError(
      gate.withWriter('', 'project_1', { purpose: 'project_update' }, async () => undefined),
      'invalid_payload'
    );
    await expectGateError(
      gate.withWriter(root, 'invalid project', { purpose: 'project_update' }, async () => undefined),
      'invalid_payload'
    );
    await expectGateError(
      gate.withWriter(root, 'project_1', { purpose: 'unknown' } as never, async () => undefined),
      'invalid_payload'
    );
    await expectGateError(
      gate.withWriter(
        root,
        'project_1',
        { purpose: 'proposal_terminal', proposalId: 'unsafe proposal id' },
        async () => undefined
      ),
      'invalid_payload'
    );
    await expectGateError(gate.readIntent('', 'project_1'), 'invalid_payload');
    await expectGateError(gate.waitForLocalWriter(root, 'invalid project'), 'invalid_payload');
    await expectGateError(gate.assertUnlocked(root, 'invalid project'), 'invalid_payload');
    await expectGateError(gate.listRecoveryCandidates(''), 'invalid_payload');
  });

  it('admits a 235-byte project id at NAME_MAX and rejects 236 bytes before filesystem I/O', async () => {
    const root = await temporaryRoot();
    const lstatSpy = vi.fn(nodeFs.lstat.bind(nodeFs));
    const fs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'lstat') return lstatSpy;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const gate = createStudioProjectWriterGateV4({ fs, mainInstanceId: 'main_instance_01' });
    await expectGateError(
      gate.withWriter(root, 'p'.repeat(236), { purpose: 'project_update' }, async () => undefined),
      'invalid_payload'
    );
    expect(lstatSpy).not.toHaveBeenCalled();

    await expect(
      gate.withWriter(root, 'p'.repeat(235), { purpose: 'project_update' }, async () => undefined)
    ).resolves.toBeUndefined();
  });

  it('does not use hard links even when link reports ENOTSUP', async () => {
    const root = await temporaryRoot();
    const link = vi.fn(async () => {
      throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' });
    });
    const fs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'link') return link;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const gate = createStudioProjectWriterGateV4({ fs, mainInstanceId: 'main_instance_01' });

    await expect(
      gate.withWriter(root, 'project_1', { purpose: 'project_update' }, async () => undefined)
    ).resolves.toBeUndefined();
    expect(link).not.toHaveBeenCalled();
  });

  it('fences only local publication, then reports durable disk busy while the owner still runs', async () => {
    const root = await temporaryRoot();
    let releasePublication!: () => void;
    let announceOwnerDurable!: () => void;
    const publicationPaused = new Promise<void>((resolve) => {
      announceOwnerDurable = resolve;
    });
    const publicationReleased = new Promise<void>((resolve) => {
      releasePublication = resolve;
    });
    let releaseOperation!: () => void;
    let announceOperation!: () => void;
    const operationEntered = new Promise<void>((resolve) => {
      announceOperation = resolve;
    });
    const operationReleased = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    const first = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_01',
      createOperationId: () => 'operation_first_01',
      onStep: async (step) => {
        if (step !== 'owner_durable') return;
        announceOwnerDurable();
        await publicationReleased;
      },
    });
    const firstRun = first.withWriter(root, 'project_1', { purpose: 'project_update' }, async () => {
      announceOperation();
      await operationReleased;
    });
    await publicationPaused;

    const second = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_02',
      createOperationId: () => 'operation_second_01',
    });
    let secondSettled = false;
    const secondOutcome = second
      .withWriter(root, 'project_1', { purpose: 'project_update' }, async () => undefined)
      .then(
        () => ({ status: 'fulfilled' as const }),
        (error: unknown) => ({ status: 'rejected' as const, error })
      )
      .finally(() => {
        secondSettled = true;
      });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(secondSettled).toBe(false);

    releasePublication();
    await operationEntered;
    const outcome = await secondOutcome;
    expect(outcome).toMatchObject({
      status: 'rejected',
      error: { name: 'StudioProjectWriterGateErrorV4', code: 'busy' },
    });
    releaseOperation();
    await expect(firstRun).resolves.toBeUndefined();
  });

  it('reclassifies a complete lock retired during final inspection as absent without leaking ENOENT', async () => {
    const root = await temporaryRoot();
    const projectId = 'project_1';
    const lock = lockPath(root, projectId);
    let releaseWriter!: () => void;
    let announceWriter!: () => void;
    const writerEntered = new Promise<void>((resolve) => {
      announceWriter = resolve;
    });
    const writerReleased = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const writer = createStudioProjectWriterGateV4({ mainInstanceId: 'main_instance_01' });
    const writerRun = writer.withWriter(root, projectId, { purpose: 'project_update' }, async () => {
      announceWriter();
      await writerReleased;
    });
    await writerEntered;

    let lockLstatCount = 0;
    let releaseInspection!: () => void;
    let announceInspection!: () => void;
    const inspectionPaused = new Promise<void>((resolve) => {
      announceInspection = resolve;
    });
    const inspectionReleased = new Promise<void>((resolve) => {
      releaseInspection = resolve;
    });
    const interceptedLstat = vi.fn(async (...args: unknown[]) => {
      if (String(args[0]) === lock && ++lockLstatCount === 2) {
        announceInspection();
        await inspectionReleased;
      }
      return (nodeFs.lstat as unknown as (...values: unknown[]) => Promise<unknown>)(...args);
    });
    const observingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'lstat') return interceptedLstat;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const observer = createStudioProjectWriterGateV4({
      fs: observingFs,
      mainInstanceId: 'main_instance_02',
    });
    const observation = observer.readIntent(root, projectId);
    await inspectionPaused;

    releaseWriter();
    await expect(writerRun).resolves.toBeUndefined();
    await expect(lstat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    releaseInspection();
    await expect(observation).resolves.toBeNull();
  });

  it('accepts synthesized Windows modes while retaining strict POSIX permission checks', async () => {
    const root = await temporaryRoot();
    const projectId = 'project_1';
    const lock = await createCompleteLock(root, projectId);
    await chmod(lock, 0o777);
    await chmod(path.join(lock, 'owner.json'), 0o666);
    await chmod(path.join(lock, 'ready'), 0o777);

    const windows = createStudioProjectWriterGateV4({ platform: 'win32', mainInstanceId: 'main_instance_new' });
    await expect(windows.readIntent(root, projectId)).resolves.toEqual({ purpose: 'project_update' });

    const posix = createStudioProjectWriterGateV4({ platform: 'linux', mainInstanceId: 'main_instance_new' });
    await expectGateError(posix.readIntent(root, projectId), 'storage_error');
  });

  it('rejects non-object, semantically invalid, and non-canonical durable owner records', async () => {
    const root = await temporaryRoot();
    const gate = createStudioProjectWriterGateV4({ mainInstanceId: 'main_instance_01' });
    const commitOwner = async (projectId: string, bytes: string): Promise<void> => {
      const lock = lockPath(root, projectId);
      await mkdir(lock, { mode: 0o700 });
      await writeFile(path.join(lock, 'owner.json'), bytes, { mode: 0o600 });
      await mkdir(path.join(lock, 'ready'), { mode: 0o700 });
    };

    await commitOwner('project_null', 'null');
    await expectGateError(gate.readIntent(root, 'project_null'), 'storage_error');

    await commitOwner(
      'project_wrong_schema',
      JSON.stringify({
        ...JSON.parse(ownerBytes('project_wrong_schema')),
        schemaVersion: 2,
      })
    );
    await expectGateError(gate.readIntent(root, 'project_wrong_schema'), 'storage_error');

    await commitOwner('project_noncanonical', `${ownerBytes('project_noncanonical')} `);
    await expectGateError(gate.readIntent(root, 'project_noncanonical'), 'storage_error');
  });

  it('rejects aliased roots and unsafe lock-directory and owner-file permissions', async () => {
    const root = await temporaryRoot();
    const gate = createStudioProjectWriterGateV4({ mainInstanceId: 'main_instance_01' });
    const rootAlias = `${root}-alias`;
    roots.push(rootAlias);
    await symlink(root, rootAlias);
    await expectGateError(gate.readIntent(rootAlias, 'project_absent'), 'storage_error');

    const openLock = await createCompleteLock(root, 'project_open_lock', 'operation_open_lock');
    await chmod(openLock, 0o755);
    await expectGateError(gate.readIntent(root, 'project_open_lock'), 'storage_error');

    const openOwner = await createCompleteLock(root, 'project_open_owner', 'operation_open_owner');
    await chmod(path.join(openOwner, 'owner.json'), 0o644);
    await expectGateError(gate.readIntent(root, 'project_open_owner'), 'storage_error');
  });

  it('rejects non-empty ready and malformed recovery directories without interpreting their contents', async () => {
    const root = await temporaryRoot();
    const gate = createStudioProjectWriterGateV4({ mainInstanceId: 'main_instance_01' });
    const nonEmptyReady = await createCompleteLock(root, 'project_ready', 'operation_ready_01');
    await writeFile(path.join(nonEmptyReady, 'ready', 'foreign'), 'keep', 'utf8');
    await expectGateError(gate.readIntent(root, 'project_ready'), 'storage_error');

    const malformedRecovery = await createCompleteLock(root, 'project_recovery', 'operation_recovery_01');
    await mkdir(path.join(malformedRecovery, 'recovery'), { mode: 0o700 });
    await writeFile(path.join(malformedRecovery, 'recovery', 'foreign'), 'keep', { mode: 0o600 });
    await expectGateError(gate.readIntent(root, 'project_recovery'), 'storage_error');
  });

  it('classifies a semantically invalid recovery claim as stale and removes only that claim', async () => {
    const root = await temporaryRoot();
    const projectId = 'project_1';
    const lock = await createCompleteLock(root, projectId, 'operation_old_01');
    const recovery = path.join(lock, 'recovery');
    await mkdir(recovery, { mode: 0o700 });
    await writeFile(
      path.join(recovery, 'claim.json'),
      JSON.stringify({
        schemaVersion: 2,
        projectId,
        ownerOperationId: 'operation_old_01',
        recoveryOperationId: 'operation_recovery_01',
        mainInstanceId: 'main_instance_stale',
        purpose: 'project_update',
        proposalId: null,
      }),
      { mode: 0o600 }
    );
    const gate = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_recovery',
      hasSingleInstanceRecoveryAuthority: () => true,
    });

    await expect(gate.listRecoveryCandidates(root)).resolves.toEqual([
      {
        schemaVersion: 1,
        projectId,
        operationId: 'operation_old_01',
        mainInstanceId: 'main_instance_old',
        purpose: 'project_update',
        proposalId: null,
      },
    ]);
    await expect(lstat(recovery)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(gate.readIntent(root, projectId)).resolves.toEqual({ purpose: 'project_update' });
  });

  it('classifies safe incomplete locks busy, unsafe source shapes as storage errors, and cleans only at startup', async () => {
    const root = await temporaryRoot();
    const ordinary = createStudioProjectWriterGateV4({ mainInstanceId: 'main_instance_ordinary' });
    const recovery = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_recovery',
      hasSingleInstanceRecoveryAuthority: () => true,
    });
    const projectId = 'project_1';
    const lock = lockPath(root, projectId);
    await mkdir(lock, { mode: 0o700 });
    await writeFile(path.join(lock, 'owner.json'), '{', { mode: 0o600 });

    await expectGateError(ordinary.readIntent(root, projectId), 'busy');
    await expectGateError(ordinary.assertUnlocked(root, projectId), 'busy');
    await expectGateError(
      ordinary.withWriter(root, projectId, { purpose: 'project_update' }, async () => undefined),
      'busy'
    );
    await expectGateError(
      createStudioProjectWriterGateV4({
        mainInstanceId: 'main_instance_denied',
        hasSingleInstanceRecoveryAuthority: () => false,
      }).listRecoveryCandidates(root),
      'recovery_refused'
    );
    await expect(recovery.listRecoveryCandidates(root)).resolves.toEqual([]);
    expect(await readdir(root)).toEqual([]);

    await writeFile(lock, 'foreign', 'utf8');
    await expectGateError(ordinary.readIntent(root, projectId), 'storage_error');
    await rm(lock);
    const target = path.join(root, 'source-target');
    await mkdir(target);
    await symlink(target, lock);
    await expectGateError(ordinary.assertUnlocked(root, projectId), 'storage_error');
  });

  it.each(['owner_symlink', 'owner_directory'] as const)(
    'never follows unsafe %s in a committed lock',
    async (shape) => {
      const root = await temporaryRoot();
      const projectId = 'project_1';
      const lock = lockPath(root, projectId);
      await mkdir(lock, { mode: 0o700 });
      const owner = path.join(lock, 'owner.json');
      if (shape === 'owner_symlink') {
        const source = path.join(root, 'external-owner');
        await writeFile(source, ownerBytes(projectId), { mode: 0o600 });
        await symlink(source, owner);
      } else {
        await mkdir(owner, { mode: 0o700 });
      }
      await mkdir(path.join(lock, 'ready'), { mode: 0o700 });
      const gate = createStudioProjectWriterGateV4({
        mainInstanceId: 'main_instance_recovery',
        hasSingleInstanceRecoveryAuthority: () => true,
      });

      await expectGateError(gate.readIntent(root, projectId), 'storage_error');
      await expectGateError(gate.listRecoveryCandidates(root), 'storage_error');
    }
  );

  it('fails closed on ready with missing or corrupt owner, but removes owner-only crash states', async () => {
    const root = await temporaryRoot();
    const gate = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_recovery',
      hasSingleInstanceRecoveryAuthority: () => true,
    });
    const partialId = 'project_partial';
    const partial = lockPath(root, partialId);
    await mkdir(partial, { mode: 0o700 });
    await writeFile(path.join(partial, 'owner.json'), ownerBytes(partialId), { mode: 0o600 });
    await expect(gate.listRecoveryCandidates(root)).resolves.toEqual([]);
    await expect(lstat(partial)).rejects.toMatchObject({ code: 'ENOENT' });

    const corruptId = 'project_corrupt';
    const corrupt = lockPath(root, corruptId);
    await mkdir(corrupt, { mode: 0o700 });
    await writeFile(path.join(corrupt, 'owner.json'), '{', { mode: 0o600 });
    await mkdir(path.join(corrupt, 'ready'), { mode: 0o700 });
    await expectGateError(gate.listRecoveryCandidates(root), 'storage_error');
    expect((await lstat(corrupt)).isDirectory()).toBe(true);
  });

  it('inventories project ids beginning pending- and rejects a canonical lock with a foreign child', async () => {
    const root = await temporaryRoot();
    await abandonProjectGate(root, 'pending-project_1');
    const gate = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_recovery',
      hasSingleInstanceRecoveryAuthority: () => true,
      createOperationId: () => 'operation_recovery_01',
    });
    await expect(gate.listRecoveryCandidates(root)).resolves.toEqual([
      {
        schemaVersion: 1,
        projectId: 'pending-project_1',
        operationId: 'operation_old_01',
        mainInstanceId: 'main_instance_old',
        purpose: 'project_update',
        proposalId: null,
      },
    ]);
    await expect(
      gate.recoverWriter(root, 'pending-project_1', { purpose: 'project_update' }, async () => undefined)
    ).resolves.toBeUndefined();

    const foreign = await createCompleteLock(root, 'project_foreign', 'operation_old_02');
    await writeFile(path.join(foreign, 'foreign'), 'keep', 'utf8');
    await expectGateError(gate.listRecoveryCandidates(root), 'storage_error');
    expect(await readFile(path.join(foreign, 'foreign'), 'utf8')).toBe('keep');
  });

  it('removes a foreign incomplete reservation without invalidating a complete canonical owner', async () => {
    const root = await temporaryRoot();
    await createCompleteLock(root, 'project_complete', 'operation_complete_01');
    const partial = lockPath(root, 'project_partial');
    await mkdir(partial, { mode: 0o700 });
    await writeFile(path.join(partial, 'owner.json'), ownerBytes('project_partial', 'operation_partial_01'), {
      mode: 0o600,
    });
    const gate = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_recovery',
      hasSingleInstanceRecoveryAuthority: () => true,
    });

    await expect(gate.listRecoveryCandidates(root)).resolves.toEqual([
      {
        schemaVersion: 1,
        projectId: 'project_complete',
        operationId: 'operation_complete_01',
        mainInstanceId: 'main_instance_old',
        purpose: 'project_update',
        proposalId: null,
      },
    ]);
    await expect(lstat(partial)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(gate.readIntent(root, 'project_complete')).resolves.toEqual({ purpose: 'project_update' });
  });

  it('serializes independent recoverers and never evicts a live held recovery claim', async () => {
    const root = await temporaryRoot();
    await abandonProjectGate(root, 'project_1');
    let announce!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const operation = vi.fn(async () => {
      announce();
      await released;
    });
    const first = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_new_1',
      hasSingleInstanceRecoveryAuthority: () => true,
      createOperationId: () => 'operation_recovery_01',
    });
    const second = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_new_2',
      hasSingleInstanceRecoveryAuthority: () => true,
      createOperationId: () => 'operation_recovery_02',
    });
    const firstRun = first.recoverWriter(root, 'project_1', { purpose: 'project_update' }, operation);
    await held;
    expect(await readdir(path.join(lockPath(root, 'project_1'), 'recovery'))).toEqual(['claim.json']);
    const secondOperation = vi.fn(async () => undefined);
    const secondRun = second.recoverWriter(root, 'project_1', { purpose: 'project_update' }, secondOperation);
    await new Promise((resolve) => setImmediate(resolve));
    expect(secondOperation).not.toHaveBeenCalled();
    expect((await lstat(path.join(lockPath(root, 'project_1'), 'recovery'))).isDirectory()).toBe(true);

    release();
    await expect(firstRun).resolves.toBeUndefined();
    await expectGateError(secondRun, 'recovery_refused');
    expect(operation).toHaveBeenCalledOnce();
    expect(secondOperation).not.toHaveBeenCalled();
  });

  it('refuses recovery under a different purpose or proposal id, then admits the exact terminal intent', async () => {
    const root = await temporaryRoot();
    await createCompleteLock(root, 'project_update', 'operation_update_01');
    await createCompleteLock(root, 'project_terminal', 'operation_terminal_01', 'proposal_terminal');
    const operation = vi.fn(async () => undefined);
    const gate = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_recovery',
      hasSingleInstanceRecoveryAuthority: () => true,
      createOperationId: () => 'operation_recovery_01',
    });

    await expectGateError(
      gate.recoverWriter(root, 'project_update', { purpose: 'proposal_terminal', proposalId: 'proposal_1' }, operation),
      'recovery_refused'
    );
    await expectGateError(
      gate.recoverWriter(
        root,
        'project_terminal',
        { purpose: 'proposal_terminal', proposalId: 'proposal_2' },
        operation
      ),
      'recovery_refused'
    );
    expect(operation).not.toHaveBeenCalled();

    await expect(
      gate.recoverWriter(
        root,
        'project_terminal',
        { purpose: 'proposal_terminal', proposalId: 'proposal_1' },
        operation
      )
    ).resolves.toBeUndefined();
    expect(operation).toHaveBeenCalledOnce();
    await expect(gate.readIntent(root, 'project_update')).resolves.toEqual({ purpose: 'project_update' });
  });

  it('cleans prior-process partial recovery claims only under startup authority', async () => {
    const root = await temporaryRoot();
    const lock = await createCompleteLock(root, 'project_1');
    await mkdir(path.join(lock, 'recovery'), { mode: 0o700 });
    const denied = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_denied',
      hasSingleInstanceRecoveryAuthority: () => false,
    });
    await expectGateError(denied.listRecoveryCandidates(root), 'recovery_refused');
    expect((await lstat(path.join(lock, 'recovery'))).isDirectory()).toBe(true);

    const allowed = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_recovery',
      hasSingleInstanceRecoveryAuthority: () => true,
    });
    await expect(allowed.listRecoveryCandidates(root)).resolves.toEqual([
      {
        schemaVersion: 1,
        projectId: 'project_1',
        operationId: 'operation_old_01',
        mainInstanceId: 'main_instance_old',
        purpose: 'project_update',
        proposalId: null,
      },
    ]);
    await expect(lstat(path.join(lock, 'recovery'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rechecks single-instance authority before recovery callback and from lease.assertOwned', async () => {
    const root = await temporaryRoot();
    await abandonProjectGate(root, 'project_1');
    let authorized = true;
    const operation = vi.fn(async () => undefined);
    const gate = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_recovery',
      hasSingleInstanceRecoveryAuthority: () => authorized,
      createOperationId: () => 'operation_recovery_01',
      onStep: (step) => {
        if (step === 'recovery_claim_durable') authorized = false;
      },
    });
    await expectGateError(
      gate.recoverWriter(root, 'project_1', { purpose: 'project_update' }, operation),
      'recovery_refused'
    );
    expect(operation).not.toHaveBeenCalled();

    authorized = true;
    const resumed = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_recovery_2',
      hasSingleInstanceRecoveryAuthority: () => authorized,
      createOperationId: () => 'operation_recovery_02',
    });
    await expect(
      resumed.recoverWriter(root, 'project_1', { purpose: 'project_update' }, async (lease) => {
        authorized = false;
        await expectGateError(lease.assertOwned(), 'recovery_refused');
        authorized = true;
      })
    ).resolves.toBeUndefined();
  });

  it('rechecks single-instance authority before retiring a recovered writer', async () => {
    const root = await temporaryRoot();
    await abandonProjectGate(root, 'project_1');
    let authorized = true;
    const gate = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_recovery',
      hasSingleInstanceRecoveryAuthority: () => authorized,
      createOperationId: () => 'operation_recovery_01',
    });

    await expectGateError(
      gate.recoverWriter(root, 'project_1', { purpose: 'project_update' }, async () => {
        authorized = false;
      }),
      'recovery_refused'
    );
    expect((await lstat(lockPath(root, 'project_1'))).isDirectory()).toBe(true);
    expect(await readFile(path.join(lockPath(root, 'project_1'), 'owner.json'), 'utf8')).toBe(ownerBytes('project_1'));
  });

  it.each(['incomplete_gate', 'stale_recovery_claim', 'retired_residue'] as const)(
    'preserves a %s when startup authority disappears immediately before cleanup',
    async (shape) => {
      const root = await temporaryRoot();
      const projectId = 'project_1';
      let watchedPath: string;
      let expectedPath: string;
      if (shape === 'incomplete_gate') {
        expectedPath = lockPath(root, projectId);
        await mkdir(expectedPath, { mode: 0o700 });
        await writeFile(path.join(expectedPath, 'owner.json'), ownerBytes(projectId), { mode: 0o600 });
        watchedPath = expectedPath;
      } else if (shape === 'stale_recovery_claim') {
        expectedPath = await createCompleteLock(root, projectId);
        watchedPath = path.join(expectedPath, 'recovery');
        await mkdir(watchedPath, { mode: 0o700 });
      } else {
        expectedPath = path.join(root, '.project-write-retired-operation_old_01');
        await createCompleteLock(root, projectId);
        await rename(lockPath(root, projectId), expectedPath);
        watchedPath = path.join(expectedPath, 'ready');
      }

      let authorized = true;
      let watchedReads = 0;
      const interceptedReaddir = vi.fn(async (...args: unknown[]) => {
        const result = await (nodeFs.readdir as unknown as (...values: unknown[]) => Promise<unknown>)(...args);
        if (String(args[0]) === watchedPath && ++watchedReads === 2) authorized = false;
        return result;
      });
      const fs = new Proxy(nodeFs, {
        get(target, property, receiver) {
          if (property === 'readdir') return interceptedReaddir;
          return Reflect.get(target, property, receiver) as unknown;
        },
      });
      const recovery = createStudioProjectWriterGateV4({
        fs,
        mainInstanceId: 'main_instance_recovery',
        hasSingleInstanceRecoveryAuthority: () => authorized,
      });

      await expectGateError(recovery.listRecoveryCandidates(root), 'recovery_refused');
      expect((await lstat(expectedPath)).isDirectory()).toBe(true);
      if (shape === 'incomplete_gate') {
        expect(await readFile(path.join(expectedPath, 'owner.json'), 'utf8')).toBe(ownerBytes(projectId));
      } else if (shape === 'stale_recovery_claim') {
        expect((await lstat(watchedPath)).isDirectory()).toBe(true);
      } else {
        expect((await lstat(path.join(expectedPath, 'owner.json'))).isFile()).toBe(true);
      }
    }
  );

  it('recovers a completed local writer retained by the same Main instance', async () => {
    const root = await temporaryRoot();
    const operation = vi.fn(async () => undefined);
    const gate = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_same',
      hasSingleInstanceRecoveryAuthority: () => true,
      createOperationId: (() => {
        let index = 0;
        return () => `operation_same_${++index}`;
      })(),
    });
    await expect(
      gate.withWriter(root, 'project_1', { purpose: 'project_update' }, async (lease) => {
        lease.retainForRecovery();
        throw new Error('local writer interrupted');
      })
    ).rejects.toThrow('local writer interrupted');

    await expect(
      gate.recoverWriter(root, 'project_1', { purpose: 'project_update' }, operation)
    ).resolves.toBeUndefined();
    expect(operation).toHaveBeenCalledOnce();
    expect(await readdir(root)).toEqual([]);
  });

  it('retires a recovered writer after an acknowledged rollback failure', async () => {
    const root = await temporaryRoot();
    await abandonProjectGate(root, 'project_1');
    const gate = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_recovery',
      hasSingleInstanceRecoveryAuthority: () => true,
      createOperationId: () => 'operation_recovery_01',
    });

    await expect(
      gate.recoverWriter(root, 'project_1', { purpose: 'project_update' }, async (lease) => {
        lease.clearRecoveryRetention();
        throw new Error('rollback completed; downstream work failed');
      })
    ).rejects.toThrow('rollback completed; downstream work failed');
    expect(await readdir(root)).toEqual([]);
  });

  it('lets a contender reserve the canonical name while the previous owner is paused in retirement', async () => {
    const root = await temporaryRoot();
    let announceRetired!: () => void;
    let releaseRetired!: () => void;
    const retired = new Promise<void>((resolve) => {
      announceRetired = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      releaseRetired = resolve;
    });
    const first = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_01',
      createOperationId: () => 'operation_first_01',
      onStep: async (step) => {
        if (step !== 'retired') return;
        announceRetired();
        await resume;
      },
    });
    const firstRun = first.withWriter(root, 'project_1', { purpose: 'project_update' }, async () => undefined);
    await retired;
    expect(await readdir(root)).toEqual(['.project-write-retired-operation_first_01']);

    let releaseSecond!: () => void;
    const secondHeld = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const second = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_02',
      createOperationId: () => 'operation_second_01',
    });
    let secondEntered = false;
    const secondRun = second.withWriter(root, 'project_1', { purpose: 'project_update' }, async () => {
      secondEntered = true;
      await secondHeld;
    });
    await vi.waitFor(() => expect(secondEntered).toBe(true));
    expect((await lstat(lockPath(root, 'project_1'))).isDirectory()).toBe(true);

    releaseRetired();
    await expect(firstRun).resolves.toBeUndefined();
    expect((await lstat(lockPath(root, 'project_1'))).isDirectory()).toBe(true);
    releaseSecond();
    await expect(secondRun).resolves.toBeUndefined();
    expect(await readdir(root)).toEqual([]);
  });

  it('leaves a deterministic retired residue on interruption and startup removes it without recursive rm', async () => {
    const root = await temporaryRoot();
    const rmdir = vi.fn(nodeFs.rmdir.bind(nodeFs));
    const rmSpy = vi.fn(nodeFs.rm.bind(nodeFs));
    const fs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'rmdir') return rmdir;
        if (property === 'rm') return rmSpy;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const writer = createStudioProjectWriterGateV4({
      fs,
      mainInstanceId: 'main_instance_old',
      createOperationId: () => 'operation_retired_01',
      onStep: (step) => {
        if (step === 'retirement_durable') throw new Error('simulated retirement crash');
      },
    });
    await expect(
      writer.withWriter(root, 'project_1', { purpose: 'project_update' }, async () => undefined)
    ).rejects.toThrow('simulated retirement crash');
    expect(await readdir(root)).toEqual(['.project-write-retired-operation_retired_01']);

    const recovery = createStudioProjectWriterGateV4({
      fs,
      mainInstanceId: 'main_instance_recovery',
      hasSingleInstanceRecoveryAuthority: () => true,
    });
    await expect(recovery.listRecoveryCandidates(root)).resolves.toEqual([]);
    expect(await readdir(root)).toEqual([]);
    expect(rmdir).toHaveBeenCalled();
    expect(rmSpy).not.toHaveBeenCalled();
  });

  it('refuses unsafe, structurally incomplete, and owner-mismatched retired residues', async () => {
    const unsafeRoot = await temporaryRoot();
    await mkdir(path.join(unsafeRoot, '.project-write-retired-bad'), { mode: 0o700 });
    const unsafeGate = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_recovery',
      hasSingleInstanceRecoveryAuthority: () => true,
    });
    await expectGateError(unsafeGate.listRecoveryCandidates(unsafeRoot), 'storage_error');

    const incompleteRoot = await temporaryRoot();
    const incomplete = path.join(incompleteRoot, '.project-write-retired-operation_incomplete_01');
    await mkdir(incomplete, { mode: 0o700 });
    await writeFile(path.join(incomplete, 'owner.json'), ownerBytes('project_incomplete'), { mode: 0o600 });
    const incompleteGate = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_recovery',
      hasSingleInstanceRecoveryAuthority: () => true,
    });
    await expectGateError(incompleteGate.listRecoveryCandidates(incompleteRoot), 'storage_error');

    const mismatchRoot = await temporaryRoot();
    await createCompleteLock(mismatchRoot, 'project_mismatch', 'operation_owner_01');
    await rename(
      lockPath(mismatchRoot, 'project_mismatch'),
      path.join(mismatchRoot, '.project-write-retired-operation_path_01')
    );
    const mismatchGate = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_recovery',
      hasSingleInstanceRecoveryAuthority: () => true,
    });
    await expectGateError(mismatchGate.listRecoveryCandidates(mismatchRoot), 'storage_error');
  });

  it('never follows a swapped retired directory and keeps deletion bounded to captured children', async () => {
    const root = await temporaryRoot();
    const retired = path.join(root, '.project-write-retired-operation_000001');
    const captured = path.join(root, 'captured-retired');
    const external = path.join(root, 'external');
    await mkdir(external);
    await writeFile(path.join(external, 'sentinel'), 'keep', 'utf8');
    const gate = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_01',
      createOperationId: () => 'operation_000001',
      onStep: async (step) => {
        if (step !== 'retired') return;
        await rename(retired, captured);
        await symlink(external, retired);
      },
    });

    await expectGateError(
      gate.withWriter(root, 'project_1', { purpose: 'project_update' }, async () => undefined),
      'storage_error'
    );
    expect(await readFile(path.join(external, 'sentinel'), 'utf8')).toBe('keep');
    expect((await lstat(retired)).isSymbolicLink()).toBe(true);
    expect((await lstat(captured)).isDirectory()).toBe(true);
  });

  it('does not accumulate residues across repeated successful writes', async () => {
    const root = await temporaryRoot();
    let sequence = 0;
    const gate = createStudioProjectWriterGateV4({
      mainInstanceId: 'main_instance_01',
      createOperationId: () => `operation_${String(++sequence).padStart(8, '0')}`,
    });
    for (let index = 0; index < 32; index += 1) {
      // eslint-disable-next-line no-await-in-loop -- Sequential reuse is the residue invariant under test.
      await gate.withWriter(root, 'project_1', { purpose: 'project_update' }, async () => undefined);
    }
    expect(await readdir(root)).toEqual([]);
  });

  it('opens owner files exclusively and without following links', async () => {
    const root = await temporaryRoot();
    const openSpy = vi.fn(open);
    const fs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'open') return openSpy;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const gate = createStudioProjectWriterGateV4({ fs, mainInstanceId: 'main_instance_01' });
    await gate.withWriter(root, 'project_1', { purpose: 'project_update' }, async () => undefined);
    const ownerOpen = openSpy.mock.calls.find((call) => String(call[0]).endsWith(`${path.sep}owner.json`));
    expect(ownerOpen).toBeDefined();
    expect(typeof ownerOpen?.[1]).toBe('number');
  });
});
