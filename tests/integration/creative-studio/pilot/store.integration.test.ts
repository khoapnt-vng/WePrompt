/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createCreativeStudioPilotStoreV3,
  CreativeStudioPilotStoreErrorV3,
  type CreativeStudioPilotStoreOptionsV3,
  type CreativeStudioPilotStoreV3,
  type StudioPilotStorageStepV3,
} from '@process/services/creative-studio/store/pilotStore';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-v3-store-'));
  roots.push(root);
  return root;
};

const deterministicOptions = (
  rootDir: string,
  overrides: Partial<CreativeStudioPilotStoreOptionsV3> = {}
): CreativeStudioPilotStoreOptionsV3 => {
  let clock = Date.parse('2026-08-31T00:00:00.000Z');
  let projectId = 0;
  let temporaryId = 0;
  let deletionClaim = 0;
  return {
    rootDir,
    now: () => new Date(clock++).toISOString(),
    createProjectId: () => `project_v3_${++projectId}`,
    createTemporaryId: () => `temporary_${String(++temporaryId).padStart(8, '0')}`,
    deletionClaimOptions: {
      now: () => 1_000,
      createToken: () => `studio-delete-v3_${String(++deletionClaim).padStart(32, 'a')}`,
    },
    ...overrides,
  };
};

const projectDirectory = (root: string, projectId: string): string => path.join(root, projectId);
const manifestFile = (root: string, projectId: string): string =>
  path.join(projectDirectory(root, projectId), 'project.json');
const briefFile = (root: string, projectId: string): string => path.join(projectDirectory(root, projectId), 'brief.md');
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

const writeRawProject = async (root: string, projectId: string, manifest: unknown, brief?: string): Promise<void> => {
  const directory = projectDirectory(root, projectId);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'project.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (brief !== undefined) await writeFile(path.join(directory, 'brief.md'), brief, 'utf8');
};

const expectStoreError = async (
  promise: Promise<unknown>,
  code: CreativeStudioPilotStoreErrorV3['code']
): Promise<void> => {
  await expect(promise).rejects.toMatchObject({ name: 'CreativeStudioPilotStoreErrorV3', code });
};

const createHealthy = async (
  root: string,
  overrides: Partial<CreativeStudioPilotStoreOptionsV3> = {}
): Promise<{ store: CreativeStudioPilotStoreV3; projectId: string }> => {
  const store = createCreativeStudioPilotStoreV3(deterministicOptions(root, overrides));
  const project = await store.createProjectV3({ name: 'Pilot lake', brief: 'One quiet photograph.' });
  return { store, projectId: project.id };
};

describe('schema-6 pilot project store', () => {
  it('creates the exact split envelope and survives load, list, summary, and Main restart', async () => {
    const root = await temporaryRoot();
    const store = createCreativeStudioPilotStoreV3(deterministicOptions(root));
    const events: unknown[] = [];
    store.watchProjectsV3((event) => events.push(event));

    const created = await store.createProjectV3({ name: '  Light on water  ', brief: 'A single reflection.' });
    expect(created).toMatchObject({
      schemaVersion: 6,
      revision: 1,
      authoringRevision: 1,
      id: 'project_v3_1',
      name: 'Light on water',
      brief: 'A single reflection.',
      pieceOrder: [],
      pieces: {},
    });
    expect(events).toEqual([
      expect.objectContaining({ operation: 'created', projectId: created.id, committedRevision: 1 }),
    ]);

    const persistedManifest = JSON.parse(await readFile(manifestFile(root, created.id), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(Object.hasOwn(persistedManifest, 'brief')).toBe(false);
    expect(persistedManifest.briefFile).toEqual({ schemaVersion: 1, sha256: digest('A single reflection.') });
    expect(await readFile(briefFile(root, created.id), 'utf8')).toBe('A single reflection.');
    expect(await readdir(root)).toEqual([created.id]);

    const restarted = createCreativeStudioPilotStoreV3(deterministicOptions(root));
    expect(await restarted.loadProjectV3(created.id)).toEqual(created);
    expect(await restarted.summarizeProjectV3(created.id)).toEqual({
      id: created.id,
      name: 'Light on water',
      revision: 1,
      authoringRevision: 1,
      pieceCount: 0,
      updatedAt: created.updatedAt,
    });
    expect(await restarted.listProjectsV3()).toEqual([
      { classification: 'healthy', summary: expect.objectContaining({ id: created.id, revision: 1 }) },
    ]);
  });

  it('rejects non-exact create input and never lets the renderer supply durable identity', async () => {
    const root = await temporaryRoot();
    const store = createCreativeStudioPilotStoreV3(deterministicOptions(root));

    await expectStoreError(
      store.createProjectV3({ name: 'Pilot', brief: '', projectId: 'renderer_id' } as never),
      'invalid_payload'
    );
    await expectStoreError(store.createProjectV3({ name: '   ', brief: '' }), 'invalid_payload');
    expect(await store.inspectProjectsV3()).toEqual({
      healthyProjectIds: [],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
  });

  it('lists exact schema 5 as unsupported and malformed schema 6 as quarantined without hiding healthy work', async () => {
    const root = await temporaryRoot();
    const { store, projectId } = await createHealthy(root);
    await writeRawProject(root, 'legacy_5', { schemaVersion: 5, legacy: true });
    await writeRawProject(root, 'broken_6', { schemaVersion: 6, id: 'broken_6' }, 'missing required fields');
    await writeRawProject(root, 'missing_version', { id: 'missing_version' }, 'no version');
    await writeRawProject(root, 'fractional_version', { schemaVersion: 5.5 }, 'not an integer');

    expect(await store.inspectProjectsV3()).toEqual({
      healthyProjectIds: [projectId],
      unsupportedProjectIds: ['legacy_5'],
      quarantinedProjectIds: ['broken_6', 'fractional_version', 'missing_version'],
    });
    const listed = await store.listProjectsV3();
    expect(listed.map((entry) => entry.classification)).toEqual([
      'quarantined',
      'quarantined',
      'unsupported',
      'quarantined',
      'healthy',
    ]);
    expect(listed.filter((entry) => entry.classification !== 'healthy')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ catalogueId: 'legacy_5', classification: 'unsupported' }),
        expect.objectContaining({ catalogueId: 'broken_6', classification: 'quarantined' }),
      ])
    );
    await expectStoreError(store.loadProjectV3('legacy_5'), 'unsupported');
    await expectStoreError(store.loadProjectV3('broken_6'), 'quarantined');
    expect((await store.loadProjectV3(projectId)).name).toBe('Pilot lake');
  });

  it('has a strict no-default decoder and quarantines digest-divergent brief content', async () => {
    const root = await temporaryRoot();
    const { store, projectId } = await createHealthy(root);
    const manifest = JSON.parse(await readFile(manifestFile(root, projectId), 'utf8')) as Record<string, unknown>;
    delete manifest.pieceOrder;
    await writeFile(manifestFile(root, projectId), `${JSON.stringify(manifest)}\n`, 'utf8');

    expect(await store.getProjectV3(projectId)).toEqual({ status: 'quarantined', catalogueId: projectId });

    const secondRoot = await temporaryRoot();
    const second = await createHealthy(secondRoot);
    await writeFile(briefFile(secondRoot, second.projectId), 'Changed outside the correlated writer.', 'utf8');
    expect(await second.store.getProjectV3(second.projectId)).toEqual({
      status: 'quarantined',
      catalogueId: second.projectId,
    });
  });

  it('consumes unreadable claims before stale, replay, and healthy-reclassification refusals', async () => {
    const root = await temporaryRoot();
    const options = deterministicOptions(root);
    const store = createCreativeStudioPilotStoreV3(options);
    await writeRawProject(root, 'legacy', { schemaVersion: 5, value: 1 });
    const first = await store.issueDeletionClaimV3('legacy');
    await writeFile(manifestFile(root, 'legacy'), '{"schemaVersion":5,"value":2}\n', 'utf8');

    await expect(store.deleteProjectV3('legacy', { deletionClaim: first.deletionClaim })).rejects.toMatchObject({
      name: 'StudioDeletionClaimErrorV3',
      code: 'claim_mismatch',
    });
    await expect(store.deleteProjectV3('legacy', { deletionClaim: first.deletionClaim })).rejects.toMatchObject({
      name: 'StudioDeletionClaimErrorV3',
      code: 'claim_not_found',
    });

    const second = await store.issueDeletionClaimV3('legacy');
    const healthyRoot = await temporaryRoot();
    const healthy = await createHealthy(healthyRoot);
    const healthyManifest = JSON.parse(await readFile(manifestFile(healthyRoot, healthy.projectId), 'utf8')) as Record<
      string,
      unknown
    >;
    healthyManifest.id = 'legacy';
    await writeFile(manifestFile(root, 'legacy'), `${JSON.stringify(healthyManifest, null, 2)}\n`, 'utf8');
    await writeFile(
      briefFile(root, 'legacy'),
      await readFile(briefFile(healthyRoot, healthy.projectId), 'utf8'),
      'utf8'
    );

    await expect(store.deleteProjectV3('legacy', { deletionClaim: second.deletionClaim })).rejects.toMatchObject({
      name: 'StudioDeletionClaimErrorV3',
      code: 'claim_mismatch',
    });
    await expect(store.deleteProjectV3('legacy', { deletionClaim: second.deletionClaim })).rejects.toMatchObject({
      name: 'StudioDeletionClaimErrorV3',
      code: 'claim_not_found',
    });
    expect((await store.loadProjectV3('legacy')).id).toBe('legacy');
  });

  it('deletes healthy and malformed projects through their separate authorities', async () => {
    const root = await temporaryRoot();
    const { store, projectId } = await createHealthy(root);
    const events: unknown[] = [];
    store.watchProjectsV3((event) => events.push(event));
    const healthy = await store.loadProjectV3(projectId);

    await expectStoreError(
      store.deleteProjectV3(projectId, { expectedRevision: healthy.revision + 1 }),
      'stale_project'
    );
    await expect(store.deleteProjectV3(projectId, { expectedRevision: healthy.revision })).resolves.toBe(true);
    expect(await store.getProjectV3(projectId)).toEqual({ status: 'not_found', catalogueId: projectId });
    expect(events).toEqual([
      expect.objectContaining({ operation: 'deleted', projectId, previousRevision: healthy.revision }),
    ]);

    await writeRawProject(root, 'broken', { schemaVersion: 6 }, 'broken');
    const claim = await store.issueDeletionClaimV3('broken');
    await expect(store.deleteProjectV3('broken', { deletionClaim: claim.deletionClaim })).resolves.toBe(true);
    expect(await store.deleteProjectV3('broken', { deletionClaim: claim.deletionClaim })).toBe(false);
  });

  it('revalidates scoped deletion before physical removal when the manifest races after authority capture', async () => {
    const root = await temporaryRoot();
    const deletionSteps: StudioPilotStorageStepV3[] = [];
    const { store, projectId } = await createHealthy(root, {
      onStorageStep: (step) => {
        if (step.startsWith('delete:')) deletionSteps.push(step);
      },
    });

    await expect(
      store.withProjectAuthorityV3(projectId, async (authority) => {
        const manifest = JSON.parse(await readFile(manifestFile(root, projectId), 'utf8')) as Record<string, unknown>;
        manifest.name = 'Raced outside the project queue';
        await writeFile(manifestFile(root, projectId), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        return authority.delete(authority.project.revision);
      })
    ).rejects.toMatchObject({ name: 'CreativeStudioPilotStoreErrorV3', code: 'stale_project' });

    await expect(store.loadProjectV3(projectId)).resolves.toMatchObject({
      id: projectId,
      name: 'Raced outside the project queue',
    });
    expect(deletionSteps).toEqual(['delete:marker_durable']);
    expect((await readdir(root)).filter((entry) => entry.startsWith('.delete-'))).toEqual([]);
  });

  it.each<StudioPilotStorageStepV3>(['delete:marker_durable', 'delete:quarantined', 'delete:tree_removed'])(
    'recovers durable deletion state after %s',
    async (failureStep) => {
      const root = await temporaryRoot();
      const base = await createHealthy(root);
      const crashing = createCreativeStudioPilotStoreV3(
        deterministicOptions(root, {
          createProjectId: () => 'unused_project',
          onStorageStep: (step) => {
            if (step === failureStep) throw new Error('simulated process death');
          },
        })
      );
      const project = await crashing.loadProjectV3(base.projectId);
      await expectStoreError(
        crashing.deleteProjectV3(base.projectId, { expectedRevision: project.revision }),
        'storage_error'
      );

      const restarted = createCreativeStudioPilotStoreV3(deterministicOptions(root));
      expect(await restarted.getProjectV3(base.projectId)).toEqual({
        status: 'not_found',
        catalogueId: base.projectId,
      });
      expect((await readdir(root)).filter((entry) => entry.startsWith('.delete-'))).toEqual([]);
    }
  );

  it('keeps a partial create invisible and publishes a complete staged create on restart', async () => {
    const partialRoot = await temporaryRoot();
    const partial = createCreativeStudioPilotStoreV3(
      deterministicOptions(partialRoot, {
        onStorageStep: (step) => {
          if (step === 'create:brief_durable') throw new Error('simulated process death');
        },
      })
    );
    await expectStoreError(partial.createProjectV3({ name: 'Partial', brief: 'Only brief exists.' }), 'storage_error');
    const partialRestart = createCreativeStudioPilotStoreV3(deterministicOptions(partialRoot));
    expect(await partialRestart.inspectProjectsV3()).toEqual({
      healthyProjectIds: [],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });

    const completeRoot = await temporaryRoot();
    const complete = createCreativeStudioPilotStoreV3(
      deterministicOptions(completeRoot, {
        onStorageStep: (step) => {
          if (step === 'create:stage_durable') throw new Error('simulated process death');
        },
      })
    );
    await expectStoreError(
      complete.createProjectV3({ name: 'Complete stage', brief: 'Both records are durable.' }),
      'storage_error'
    );
    const completeRestart = createCreativeStudioPilotStoreV3(deterministicOptions(completeRoot));
    expect(await completeRestart.inspectProjectsV3()).toEqual({
      healthyProjectIds: ['project_v3_1'],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
    expect((await completeRestart.loadProjectV3('project_v3_1')).brief).toBe('Both records are durable.');
  });

  it.each<StudioPilotStorageStepV3>(['update:journal_durable', 'update:brief_published'])(
    'replays a correlated manifest/brief update after %s',
    async (failureStep) => {
      const root = await temporaryRoot();
      const base = await createHealthy(root);
      const crashing = createCreativeStudioPilotStoreV3(
        deterministicOptions(root, {
          createProjectId: () => 'unused_project',
          onStorageStep: (step) => {
            if (step === failureStep) throw new Error('simulated process death');
          },
        })
      );
      const before = await crashing.loadProjectV3(base.projectId);
      await expectStoreError(
        crashing.updateProjectV3(
          base.projectId,
          (project) => ({ ...project, brief: `Recovered after ${failureStep}` }),
          { expectedRevision: before.revision, kind: 'authoring' }
        ),
        'storage_error'
      );

      const restarted = createCreativeStudioPilotStoreV3(deterministicOptions(root));
      const recovered = await restarted.loadProjectV3(base.projectId);
      expect(recovered).toMatchObject({
        revision: 2,
        authoringRevision: 2,
        brief: `Recovered after ${failureStep}`,
      });
      const manifest = JSON.parse(await readFile(manifestFile(root, base.projectId), 'utf8')) as {
        briefFile: { sha256: string };
      };
      expect(manifest.briefFile.sha256).toBe(digest(recovered.brief));
      expect(await readFile(briefFile(root, base.projectId), 'utf8')).toBe(recovered.brief);
    }
  );

  it('enforces revision authority and emits only after the correlated commit is durable', async () => {
    const root = await temporaryRoot();
    const steps: StudioPilotStorageStepV3[] = [];
    const store = createCreativeStudioPilotStoreV3(
      deterministicOptions(root, {
        onStorageStep: (step) => steps.push(step),
      })
    );
    const created = await store.createProjectV3({ name: 'Authority', brief: '' });
    const observations: Array<{ event: string; lastStep: StudioPilotStorageStepV3 | undefined }> = [];
    store.watchProjectsV3((event) => observations.push({ event: event.operation, lastStep: steps.at(-1) }));

    const authored = await store.updateProjectV3(created.id, (project) => ({ ...project, name: 'Authority renamed' }), {
      expectedRevision: created.revision,
      kind: 'authoring',
    });
    expect(authored).toMatchObject({ revision: 2, authoringRevision: 2, name: 'Authority renamed' });
    expect(observations).toEqual([{ event: 'updated', lastStep: 'update:complete' }]);
    await expectStoreError(
      store.updateProjectV3(created.id, (project) => project, {
        expectedRevision: created.revision,
        kind: 'runtime',
      }),
      'stale_project'
    );
    expect(observations).toHaveLength(1);

    const runtime = await store.withProjectAuthorityV3(created.id, async (authority) => {
      await authority.assertCurrent();
      return authority.commit((project) => project, {
        expectedRevision: authority.project.revision,
        kind: 'runtime',
      });
    });
    expect(runtime).toMatchObject({ revision: 3, authoringRevision: 2 });
    expect(observations.at(-1)).toEqual({ event: 'updated', lastStep: 'update:complete' });
  });

  it('propagates intentional authority callback refusals without rewriting them as storage failures', async () => {
    const root = await temporaryRoot();
    const { store, projectId } = await createHealthy(root);
    const refusal = Object.assign(new Error('stale_quote'), { code: 'stale_quote' as const });

    await expect(
      store.withProjectAuthorityV3(projectId, async () => {
        throw refusal;
      })
    ).rejects.toBe(refusal);
    expect((await store.loadProjectV3(projectId)).revision).toBe(1);
  });

  it('does not notify a failed pre-journal update and leaves the prior state loadable', async () => {
    const root = await temporaryRoot();
    const base = await createHealthy(root);
    const events: unknown[] = [];
    const failing = createCreativeStudioPilotStoreV3(
      deterministicOptions(root, {
        createProjectId: () => 'unused_project',
        onStorageStep: (step) => {
          if (step === 'update:candidates_durable') throw new Error('write interrupted before journal');
        },
      })
    );
    failing.watchProjectsV3((event) => events.push(event));
    const before = await failing.loadProjectV3(base.projectId);
    await expectStoreError(
      failing.updateProjectV3(base.projectId, (project) => ({ ...project, brief: 'Must not commit' }), {
        expectedRevision: before.revision,
        kind: 'authoring',
      }),
      'storage_error'
    );
    expect(events).toEqual([]);

    const restarted = createCreativeStudioPilotStoreV3(deterministicOptions(root));
    expect(await restarted.loadProjectV3(base.projectId)).toEqual(before);
  });

  it('refuses an oversized update before authorization or filesystem mutation', async () => {
    const root = await temporaryRoot();
    const storageSteps: StudioPilotStorageStepV3[] = [];
    const options = deterministicOptions(root, {
      maxManifestBytes: 2_048,
      onStorageStep: (step) => {
        storageSteps.push(step);
      },
    });
    const store = createCreativeStudioPilotStoreV3(options);
    const created = await store.createProjectV3({ name: 'Bounded manifest', brief: 'Original brief.' });
    storageSteps.length = 0;
    const authorizeBeforeReplace = vi.fn();

    await expectStoreError(
      store.updateProjectV3(
        created.id,
        (project) => ({
          ...project,
          rules: Array.from({ length: 24 }, (_, index) => ({
            id: `rule_${index}`,
            scope: 'project' as const,
            text: `Rule ${index} ${'x'.repeat(220)}`,
            predicate: null,
            createdAt: project.createdAt,
          })),
        }),
        {
          expectedRevision: created.revision,
          kind: 'authoring',
          authorizeBeforeReplace,
        }
      ),
      'invalid_payload'
    );

    expect(authorizeBeforeReplace).not.toHaveBeenCalled();
    expect(storageSteps).toEqual([]);
    expect((await readdir(projectDirectory(root, created.id))).toSorted()).toEqual(['brief.md', 'project.json']);

    const restarted = createCreativeStudioPilotStoreV3(deterministicOptions(root));
    expect(await restarted.loadProjectV3(created.id)).toEqual(created);
  });

  it('fails closed across invalid public authority requests and isolates unreadable projects', async () => {
    const root = await temporaryRoot();
    const { store, projectId } = await createHealthy(root);
    await writeRawProject(root, 'legacy', { schemaVersion: 4 });

    await expectStoreError(store.getProjectV3('../escape'), 'invalid_payload');
    await expectStoreError(store.loadProjectV3('missing'), 'not_found');
    await expectStoreError(
      store.updateProjectV3('missing', (project) => project, { kind: 'runtime' }),
      'not_found'
    );
    await expectStoreError(
      store.updateProjectV3('legacy', (project) => project, { kind: 'runtime' }),
      'unsupported'
    );
    await expectStoreError(
      store.updateProjectV3(projectId, (project) => project, { kind: 'wrong' } as never),
      'invalid_payload'
    );
    await expectStoreError(
      store.updateProjectV3(projectId, (project) => ({ ...project, id: 'changed' }), { kind: 'authoring' }),
      'invalid_payload'
    );
    await expectStoreError(
      store.withProjectAuthorityV3('missing', async () => undefined),
      'not_found'
    );
    await expectStoreError(
      store.withProjectAuthorityV3('legacy', async () => undefined),
      'unsupported'
    );
    await expectStoreError(store.withProjectAuthorityV3(projectId, null as never), 'invalid_payload');
    await expectStoreError(store.issueDeletionClaimV3('missing'), 'not_found');
    await expectStoreError(store.issueDeletionClaimV3(projectId), 'invalid_payload');
    await expectStoreError(store.issueDeletionClaimV3('../escape'), 'invalid_payload');
    await expectStoreError(store.deleteProjectV3(projectId, {} as never), 'invalid_payload');
    await expectStoreError(store.deleteProjectV3('legacy', { expectedRevision: 1 }), 'invalid_payload');
    await expectStoreError(store.deleteProjectV3('../escape', { expectedRevision: 1 }), 'invalid_payload');

    const unsubscribe = store.watchProjectsV3(() => {
      throw new Error('observer failure cannot roll back a commit');
    });
    const before = await store.loadProjectV3(projectId);
    await expect(
      store.updateProjectV3(projectId, (project) => project, {
        expectedRevision: before.revision,
        kind: 'runtime',
      })
    ).resolves.toMatchObject({ revision: before.revision + 1 });
    unsubscribe();
    await expect(() => store.watchProjectsV3(null as never)).toThrowError(CreativeStudioPilotStoreErrorV3);
    store.close();
    store.close();
    await expect(() => store.watchProjectsV3(() => undefined)).toThrowError(CreativeStudioPilotStoreErrorV3);
    await expectStoreError(store.getProjectV3(projectId), 'storage_error');
  });

  it('uses safe production defaults and rejects invalid minted ids, clocks, and temporary ids', async () => {
    const defaultRoot = await temporaryRoot();
    const defaults = createCreativeStudioPilotStoreV3({ rootDir: defaultRoot });
    const created = await defaults.createProjectV3({ name: 'Default authority', brief: '' });
    expect(created.id).toMatch(/^project_[A-Za-z0-9_-]+$/);
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const badProjectRoot = await temporaryRoot();
    const badProject = createCreativeStudioPilotStoreV3(
      deterministicOptions(badProjectRoot, { createProjectId: () => '../renderer-path' })
    );
    await expectStoreError(badProject.createProjectV3({ name: 'Bad id', brief: '' }), 'storage_error');

    const badClockRoot = await temporaryRoot();
    const badClock = createCreativeStudioPilotStoreV3(
      deterministicOptions(badClockRoot, { now: () => 'not-a-timestamp' })
    );
    await expectStoreError(badClock.createProjectV3({ name: 'Bad clock', brief: '' }), 'storage_error');

    const badTemporaryRoot = await temporaryRoot();
    const badTemporary = createCreativeStudioPilotStoreV3(
      deterministicOptions(badTemporaryRoot, { createTemporaryId: () => 'bad' })
    );
    await expectStoreError(badTemporary.createProjectV3({ name: 'Bad temp', brief: '' }), 'storage_error');

    const duplicateRoot = await temporaryRoot();
    const duplicate = createCreativeStudioPilotStoreV3(
      deterministicOptions(duplicateRoot, { createProjectId: () => 'same_project' })
    );
    await duplicate.createProjectV3({ name: 'First', brief: '' });
    await expectStoreError(duplicate.createProjectV3({ name: 'Second', brief: '' }), 'already_exists');

    for (const maxManifestBytes of [0, 1.5, 1_048_577]) {
      expect(() =>
        createCreativeStudioPilotStoreV3(deterministicOptions(defaultRoot, { maxManifestBytes }))
      ).toThrowError(TypeError);
    }
  });

  it('isolates an invalid durable deletion marker instead of disabling inventory', async () => {
    const root = await temporaryRoot();
    const projectsRoot = root;
    await mkdir(projectsRoot, { recursive: true });
    await writeFile(path.join(projectsRoot, '.delete-invalid.json'), '{not-json', 'utf8');
    const store = createCreativeStudioPilotStoreV3(deterministicOptions(root));

    expect(await store.inspectProjectsV3()).toEqual({
      healthyProjectIds: [],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
    expect((await readdir(projectsRoot)).some((entry) => entry.startsWith('.invalid-'))).toBe(true);
  });
});
