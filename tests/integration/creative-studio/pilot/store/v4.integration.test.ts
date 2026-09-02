/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createCreativeStudioPilotStoreV3,
  createCreativeStudioPilotStoreV4,
  CreativeStudioPilotStoreErrorV4,
  STUDIO_MAX_PROJECT_MANIFEST_BYTES_V4,
  type CreativeStudioPilotStoreOptionsV4,
  type CreativeStudioPilotStoreV4,
  type StudioPilotStorageStepV4,
} from '@process/services/creative-studio/store/pilot';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-v4-store-'));
  roots.push(root);
  return root;
};

const deterministicOptions = (
  rootDir: string,
  overrides: Partial<CreativeStudioPilotStoreOptionsV4> = {}
): CreativeStudioPilotStoreOptionsV4 => {
  let clock = Date.parse('2026-08-31T00:00:00.000Z');
  let projectId = 0;
  let temporaryId = 0;
  let deletionClaim = 0;
  return {
    rootDir,
    now: () => new Date(clock++).toISOString(),
    createProjectId: () => `project_v4_${++projectId}`,
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
const digest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

const writeRawProject = async (root: string, projectId: string, manifest: unknown, brief?: string): Promise<void> => {
  const directory = projectDirectory(root, projectId);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'project.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (brief !== undefined) await writeFile(path.join(directory, 'brief.md'), brief, 'utf8');
};

const expectStoreError = async (
  promise: Promise<unknown>,
  code: CreativeStudioPilotStoreErrorV4['code']
): Promise<void> => {
  await expect(promise).rejects.toMatchObject({ name: 'CreativeStudioPilotStoreErrorV4', code });
};

const createHealthy = async (
  root: string,
  overrides: Partial<CreativeStudioPilotStoreOptionsV4> = {}
): Promise<{ store: CreativeStudioPilotStoreV4; projectId: string }> => {
  const store = createCreativeStudioPilotStoreV4(deterministicOptions(root, overrides));
  const project = await store.createProjectV4({ name: 'Pilot lake', brief: 'One quiet photograph.' });
  return { store, projectId: project.id };
};

const updateWithRuleText = (
  store: CreativeStudioPilotStoreV4,
  projectId: string,
  expectedRevision: number,
  text: string,
  authorizeBeforeReplace?: () => void | Promise<void>
) =>
  store.updateProjectV4(
    projectId,
    (project) => ({
      ...project,
      rules: [
        {
          id: 'rule_manifest_boundary',
          scope: 'project' as const,
          text,
          predicate: null,
          createdAt: project.createdAt,
        },
      ],
    }),
    { expectedRevision, kind: 'authoring', authorizeBeforeReplace }
  );

describe('inactive schema-7 pilot project store', () => {
  it('creates the exact split envelope and survives load, list, summary, and Main restart', async () => {
    const root = await temporaryRoot();
    const store = createCreativeStudioPilotStoreV4(deterministicOptions(root));
    const events: unknown[] = [];
    store.watchProjectsV4((event) => events.push(event));

    const created = await store.createProjectV4({ name: '  Light on water  ', brief: 'A single reflection.' });
    expect(created).toMatchObject({
      schemaVersion: 7,
      revision: 1,
      authoringRevision: 1,
      id: 'project_v4_1',
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

    const restarted = createCreativeStudioPilotStoreV4(deterministicOptions(root));
    expect(await restarted.loadProjectV4(created.id)).toEqual(created);
    expect(await restarted.summarizeProjectV4(created.id)).toEqual({
      id: created.id,
      name: 'Light on water',
      revision: 1,
      authoringRevision: 1,
      pieceCount: 0,
      updatedAt: created.updatedAt,
    });
    expect(await restarted.listProjectsV4()).toEqual([
      { classification: 'healthy', summary: expect.objectContaining({ id: created.id, revision: 1 }) },
    ]);
  });

  it('rejects non-exact create input and never lets the renderer supply durable identity', async () => {
    const root = await temporaryRoot();
    const store = createCreativeStudioPilotStoreV4(deterministicOptions(root));

    await expectStoreError(
      store.createProjectV4({ name: 'Pilot', brief: '', projectId: 'renderer_id' } as never),
      'invalid_payload'
    );
    await expectStoreError(store.createProjectV4({ name: '   ', brief: '' }), 'invalid_payload');
    expect(await store.inspectProjectsV4()).toEqual({
      healthyProjectIds: [],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
  });

  it('lists schema 6 and other integer versions as unsupported while quarantining malformed schema 7 without hiding healthy work', async () => {
    const root = await temporaryRoot();
    const { store, projectId } = await createHealthy(root);
    await writeRawProject(root, 'legacy_6', { schemaVersion: 6, legacy: true });
    await writeRawProject(root, 'future_8', { schemaVersion: 8, future: true });
    await writeRawProject(root, 'broken_7', { schemaVersion: 7, id: 'broken_7' }, 'missing required fields');
    await writeRawProject(root, 'missing_version', { id: 'missing_version' }, 'no version');
    await writeRawProject(root, 'fractional_version', { schemaVersion: 5.5 }, 'not an integer');

    expect(await store.inspectProjectsV4()).toEqual({
      healthyProjectIds: [projectId],
      unsupportedProjectIds: ['future_8', 'legacy_6'],
      quarantinedProjectIds: ['broken_7', 'fractional_version', 'missing_version'],
    });
    const listed = await store.listProjectsV4();
    expect(listed.map((entry) => entry.classification)).toEqual([
      'quarantined',
      'quarantined',
      'unsupported',
      'unsupported',
      'quarantined',
      'healthy',
    ]);
    expect(listed.filter((entry) => entry.classification !== 'healthy')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ catalogueId: 'legacy_6', classification: 'unsupported' }),
        expect.objectContaining({ catalogueId: 'future_8', classification: 'unsupported' }),
        expect.objectContaining({ catalogueId: 'broken_7', classification: 'quarantined' }),
      ])
    );
    await expectStoreError(store.loadProjectV4('legacy_6'), 'unsupported');
    await expectStoreError(store.loadProjectV4('broken_7'), 'quarantined');
    expect((await store.loadProjectV4(projectId)).name).toBe('Pilot lake');
  });

  it('has a strict no-default decoder and quarantines digest-divergent brief content', async () => {
    const root = await temporaryRoot();
    const { store, projectId } = await createHealthy(root);
    const manifest = JSON.parse(await readFile(manifestFile(root, projectId), 'utf8')) as Record<string, unknown>;
    delete manifest.pieceOrder;
    await writeFile(manifestFile(root, projectId), `${JSON.stringify(manifest)}\n`, 'utf8');

    expect(await store.getProjectV4(projectId)).toEqual({ status: 'quarantined', catalogueId: projectId });

    const secondRoot = await temporaryRoot();
    const second = await createHealthy(secondRoot);
    await writeFile(briefFile(secondRoot, second.projectId), 'Changed outside the correlated writer.', 'utf8');
    expect(await second.store.getProjectV4(second.projectId)).toEqual({
      status: 'quarantined',
      catalogueId: second.projectId,
    });
  });

  it('quarantines missing, id-mismatched, and oversized schema-7 records without disabling siblings', async () => {
    const root = await temporaryRoot();
    const { store, projectId } = await createHealthy(root);
    const healthyManifest = await readFile(manifestFile(root, projectId), 'utf8');
    const healthyBrief = await readFile(briefFile(root, projectId), 'utf8');

    await mkdir(projectDirectory(root, 'missing_manifest'));
    await writeFile(briefFile(root, 'missing_manifest'), 'orphan brief', 'utf8');
    await mkdir(projectDirectory(root, 'missing_brief'));
    await writeFile(manifestFile(root, 'missing_brief'), healthyManifest, 'utf8');
    await writeRawProject(root, 'id_mismatch', JSON.parse(healthyManifest) as unknown, healthyBrief);
    await mkdir(projectDirectory(root, 'oversized_7'));
    await writeFile(
      manifestFile(root, 'oversized_7'),
      `{"schemaVersion":7,"padding":"${'x'.repeat(1_048_576)}"}\n`,
      'utf8'
    );
    await writeFile(briefFile(root, 'oversized_7'), '', 'utf8');

    expect(await store.inspectProjectsV4()).toEqual({
      healthyProjectIds: [projectId],
      unsupportedProjectIds: [],
      quarantinedProjectIds: ['id_mismatch', 'missing_brief', 'missing_manifest', 'oversized_7'],
    });
    await expect(store.loadProjectV4(projectId)).resolves.toMatchObject({ id: projectId });
  });

  it('consumes unreadable claims before stale, replay, and healthy-reclassification refusals', async () => {
    const root = await temporaryRoot();
    const options = deterministicOptions(root);
    const store = createCreativeStudioPilotStoreV4(options);
    await writeRawProject(root, 'legacy', { schemaVersion: 6, value: 1 });
    const first = await store.issueDeletionClaimV4('legacy');
    await writeFile(manifestFile(root, 'legacy'), '{"schemaVersion":6,"value":2}\n', 'utf8');

    await expect(store.deleteProjectV4('legacy', { deletionClaim: first.deletionClaim })).rejects.toMatchObject({
      name: 'StudioDeletionClaimErrorV3',
      code: 'claim_mismatch',
    });
    await expect(store.deleteProjectV4('legacy', { deletionClaim: first.deletionClaim })).rejects.toMatchObject({
      name: 'StudioDeletionClaimErrorV3',
      code: 'claim_not_found',
    });

    const second = await store.issueDeletionClaimV4('legacy');
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

    await expect(store.deleteProjectV4('legacy', { deletionClaim: second.deletionClaim })).rejects.toMatchObject({
      name: 'StudioDeletionClaimErrorV3',
      code: 'claim_mismatch',
    });
    await expect(store.deleteProjectV4('legacy', { deletionClaim: second.deletionClaim })).rejects.toMatchObject({
      name: 'StudioDeletionClaimErrorV3',
      code: 'claim_not_found',
    });
    expect((await store.loadProjectV4('legacy')).id).toBe('legacy');
  });

  it('exposes only an opaque, independently versioned claim for unreadable project deletion', async () => {
    const root = await temporaryRoot();
    const store = createCreativeStudioPilotStoreV4(deterministicOptions(root));
    await writeRawProject(root, 'schema_6', { schemaVersion: 6 });

    const [entry] = await store.listProjectsV4();
    expect(entry).toEqual({
      catalogueId: 'schema_6',
      classification: 'unsupported',
      deletionClaim: expect.stringMatching(/^studio-delete-v3_[A-Za-z0-9_-]+$/),
      deletionClaimExpiresAt: '1970-01-01T00:05:01.000Z',
    });
    expect(JSON.stringify(entry)).not.toMatch(/manifest|fingerprint|directory|\bdev\b|\bino\b/);
  });

  it('deletes healthy and malformed projects through their separate authorities', async () => {
    const root = await temporaryRoot();
    const { store, projectId } = await createHealthy(root);
    const events: unknown[] = [];
    store.watchProjectsV4((event) => events.push(event));
    const healthy = await store.loadProjectV4(projectId);

    await expectStoreError(
      store.deleteProjectV4(projectId, { expectedRevision: healthy.revision + 1 }),
      'stale_project'
    );
    await expect(store.deleteProjectV4(projectId, { expectedRevision: healthy.revision })).resolves.toBe(true);
    expect(await store.getProjectV4(projectId)).toEqual({ status: 'not_found', catalogueId: projectId });
    expect(events).toEqual([
      expect.objectContaining({ operation: 'deleted', projectId, previousRevision: healthy.revision }),
    ]);

    await writeRawProject(root, 'broken', { schemaVersion: 7 }, 'broken');
    const claim = await store.issueDeletionClaimV4('broken');
    await expect(store.deleteProjectV4('broken', { deletionClaim: claim.deletionClaim })).resolves.toBe(true);
    expect(await store.deleteProjectV4('broken', { deletionClaim: claim.deletionClaim })).toBe(false);
  });

  it('revalidates scoped deletion before physical removal when the manifest races after authority capture', async () => {
    const root = await temporaryRoot();
    const deletionSteps: StudioPilotStorageStepV4[] = [];
    const { store, projectId } = await createHealthy(root, {
      onStorageStep: (step) => {
        if (step.startsWith('delete:')) deletionSteps.push(step);
      },
    });

    await expect(
      store.withProjectAuthorityV4(projectId, async (authority) => {
        const manifest = JSON.parse(await readFile(manifestFile(root, projectId), 'utf8')) as Record<string, unknown>;
        manifest.name = 'Raced outside the project queue';
        await writeFile(manifestFile(root, projectId), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        return authority.delete(authority.project.revision);
      })
    ).rejects.toMatchObject({ name: 'CreativeStudioPilotStoreErrorV4', code: 'stale_project' });

    await expect(store.loadProjectV4(projectId)).resolves.toMatchObject({
      id: projectId,
      name: 'Raced outside the project queue',
    });
    expect(deletionSteps).toEqual(['delete:marker_durable']);
    expect((await readdir(root)).filter((entry) => entry.startsWith('.delete-'))).toEqual([]);
  });

  it.each<StudioPilotStorageStepV4>(['delete:marker_durable', 'delete:quarantined', 'delete:tree_removed'])(
    'recovers durable deletion state after %s',
    async (failureStep) => {
      const root = await temporaryRoot();
      const base = await createHealthy(root);
      const crashing = createCreativeStudioPilotStoreV4(
        deterministicOptions(root, {
          createProjectId: () => 'unused_project',
          onStorageStep: (step) => {
            if (step === failureStep) throw new Error('simulated process death');
          },
        })
      );
      const project = await crashing.loadProjectV4(base.projectId);
      await expectStoreError(
        crashing.deleteProjectV4(base.projectId, { expectedRevision: project.revision }),
        'storage_error'
      );

      const restarted = createCreativeStudioPilotStoreV4(deterministicOptions(root));
      expect(await restarted.getProjectV4(base.projectId)).toEqual({
        status: 'not_found',
        catalogueId: base.projectId,
      });
      expect((await readdir(root)).filter((entry) => entry.startsWith('.delete-'))).toEqual([]);
    }
  );

  it('completes an unchanged schema-6 deletion authorized before the schema-7 cutover', async () => {
    const root = await temporaryRoot();
    const legacy = createCreativeStudioPilotStoreV3({
      ...deterministicOptions(root),
      onStorageStep: (step) => {
        if (step === 'delete:marker_durable') throw new Error('simulated schema-6 process death');
      },
    });
    const project = await legacy.createProjectV3({ name: 'Legacy deletion', brief: 'Already authorized.' });
    await expect(legacy.deleteProjectV3(project.id, { expectedRevision: project.revision })).rejects.toMatchObject({
      code: 'storage_error',
    });

    const cutover = createCreativeStudioPilotStoreV4(deterministicOptions(root));
    expect(await cutover.getProjectV4(project.id)).toEqual({ status: 'not_found', catalogueId: project.id });
    expect((await readdir(root)).filter((entry) => entry.startsWith('.delete-'))).toEqual([]);
  });

  it('completes an unchanged quarantined schema-6 deletion authorized before the schema-7 cutover', async () => {
    const root = await temporaryRoot();
    await writeRawProject(root, 'legacy_quarantined', { schemaVersion: 6 }, 'Malformed schema-6 project.');
    const legacy = createCreativeStudioPilotStoreV3({
      ...deterministicOptions(root),
      onStorageStep: (step) => {
        if (step === 'delete:marker_durable') throw new Error('simulated schema-6 process death');
      },
    });
    const claim = await legacy.issueDeletionClaimV3('legacy_quarantined');
    await expect(
      legacy.deleteProjectV3('legacy_quarantined', { deletionClaim: claim.deletionClaim })
    ).rejects.toMatchObject({ code: 'storage_error' });

    const cutover = createCreativeStudioPilotStoreV4(deterministicOptions(root));
    expect(await cutover.getProjectV4('legacy_quarantined')).toEqual({
      status: 'not_found',
      catalogueId: 'legacy_quarantined',
    });
  });

  it('does not apply a pre-cutover deletion marker to a replacement directory with identical bytes', async () => {
    const root = await temporaryRoot();
    const legacy = createCreativeStudioPilotStoreV3({
      ...deterministicOptions(root),
      onStorageStep: (step) => {
        if (step === 'delete:marker_durable') throw new Error('simulated schema-6 process death');
      },
    });
    const project = await legacy.createProjectV3({ name: 'Replaced legacy', brief: 'Same bytes, new inode.' });
    const originalManifest = await readFile(manifestFile(root, project.id));
    const originalBrief = await readFile(briefFile(root, project.id));
    await expect(legacy.deleteProjectV3(project.id, { expectedRevision: project.revision })).rejects.toMatchObject({
      code: 'storage_error',
    });

    const originalDirectory = projectDirectory(root, project.id);
    const heldDirectory = path.join(root, '.held-original-directory');
    await rename(originalDirectory, heldDirectory);
    await mkdir(originalDirectory);
    await writeFile(manifestFile(root, project.id), originalManifest);
    await writeFile(briefFile(root, project.id), originalBrief);

    const cutover = createCreativeStudioPilotStoreV4(deterministicOptions(root));
    expect(await cutover.getProjectV4(project.id)).toEqual({ status: 'unsupported', catalogueId: project.id });
    expect((await readdir(root)).filter((entry) => entry.startsWith('.delete-'))).toEqual([]);
    await rm(heldDirectory, { recursive: true });
  });

  it('keeps a partial create invisible and publishes a complete staged create on restart', async () => {
    const partialRoot = await temporaryRoot();
    const partial = createCreativeStudioPilotStoreV4(
      deterministicOptions(partialRoot, {
        onStorageStep: (step) => {
          if (step === 'create:brief_durable') throw new Error('simulated process death');
        },
      })
    );
    await expectStoreError(partial.createProjectV4({ name: 'Partial', brief: 'Only brief exists.' }), 'storage_error');
    const partialRestart = createCreativeStudioPilotStoreV4(deterministicOptions(partialRoot));
    expect(await partialRestart.inspectProjectsV4()).toEqual({
      healthyProjectIds: [],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });

    const completeRoot = await temporaryRoot();
    const complete = createCreativeStudioPilotStoreV4(
      deterministicOptions(completeRoot, {
        onStorageStep: (step) => {
          if (step === 'create:stage_durable') throw new Error('simulated process death');
        },
      })
    );
    await expectStoreError(
      complete.createProjectV4({ name: 'Complete stage', brief: 'Both records are durable.' }),
      'storage_error'
    );
    const completeRestart = createCreativeStudioPilotStoreV4(deterministicOptions(completeRoot));
    expect(await completeRestart.inspectProjectsV4()).toEqual({
      healthyProjectIds: ['project_v4_1'],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
    expect((await completeRestart.loadProjectV4('project_v4_1')).brief).toBe('Both records are durable.');
  });

  it.each<StudioPilotStorageStepV4>(['update:journal_durable', 'update:brief_published'])(
    'replays a correlated manifest/brief update after %s',
    async (failureStep) => {
      const root = await temporaryRoot();
      const base = await createHealthy(root);
      const crashing = createCreativeStudioPilotStoreV4(
        deterministicOptions(root, {
          createProjectId: () => 'unused_project',
          onStorageStep: (step) => {
            if (step === failureStep) throw new Error('simulated process death');
          },
        })
      );
      const before = await crashing.loadProjectV4(base.projectId);
      await expectStoreError(
        crashing.updateProjectV4(
          base.projectId,
          (project) => ({ ...project, brief: `Recovered after ${failureStep}` }),
          { expectedRevision: before.revision, kind: 'authoring' }
        ),
        'storage_error'
      );

      const restarted = createCreativeStudioPilotStoreV4(deterministicOptions(root));
      const recovered = await restarted.loadProjectV4(base.projectId);
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

  it('replays an independently versioned schema-6 transaction before classifying the project unsupported', async () => {
    const root = await temporaryRoot();
    const legacy = createCreativeStudioPilotStoreV3(deterministicOptions(root));
    const created = await legacy.createProjectV3({ name: 'Legacy transaction', brief: 'Before cutover.' });
    const crashing = createCreativeStudioPilotStoreV3({
      ...deterministicOptions(root),
      createProjectId: () => 'unused_project',
      onStorageStep: (step) => {
        if (step === 'update:journal_durable') throw new Error('simulated schema-6 process death');
      },
    });
    await expect(
      crashing.updateProjectV3(created.id, (project) => ({ ...project, brief: 'Committed before cutover.' }), {
        expectedRevision: created.revision,
        kind: 'authoring',
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    const cutover = createCreativeStudioPilotStoreV4(deterministicOptions(root));
    expect(await cutover.getProjectV4(created.id)).toEqual({ status: 'unsupported', catalogueId: created.id });
    expect(await readFile(briefFile(root, created.id), 'utf8')).toBe('Committed before cutover.');
    const manifest = JSON.parse(await readFile(manifestFile(root, created.id), 'utf8')) as {
      schemaVersion: number;
      revision: number;
      briefFile: { sha256: string };
    };
    expect(manifest).toMatchObject({
      schemaVersion: 6,
      revision: 2,
      briefFile: { sha256: digest('Committed before cutover.') },
    });
    expect((await readdir(projectDirectory(root, created.id))).toSorted()).toEqual(['brief.md', 'project.json']);
  });

  it('preflights both transaction candidates before replacing either live file', async () => {
    const root = await temporaryRoot();
    const base = await createHealthy(root);
    const liveManifest = await readFile(manifestFile(root, base.projectId));
    const liveBrief = await readFile(briefFile(root, base.projectId));
    const transactionId = 'oversized01';
    const manifestTemporaryFile = `.project-${transactionId}.tmp`;
    const briefTemporaryFile = `.brief-${transactionId}.tmp`;
    const oversizedCandidate = Buffer.alloc(1_048_577, 0x78);
    const changedBrief = Buffer.from('REPLACED', 'utf8');
    const projectDir = projectDirectory(root, base.projectId);
    await writeFile(path.join(projectDir, manifestTemporaryFile), oversizedCandidate);
    await writeFile(path.join(projectDir, briefTemporaryFile), changedBrief);
    await writeFile(
      path.join(projectDir, '.project-write-v3.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          projectId: base.projectId,
          transactionId,
          manifestTemporaryFile,
          briefTemporaryFile,
          previousManifestSha256: digest(liveManifest),
          previousBriefSha256: digest(liveBrief),
          nextManifestSha256: digest(oversizedCandidate),
          nextBriefSha256: digest(changedBrief),
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    const restarted = createCreativeStudioPilotStoreV4(deterministicOptions(root));
    expect(await restarted.getProjectV4(base.projectId)).toEqual({
      status: 'quarantined',
      catalogueId: base.projectId,
    });
    expect(await readFile(manifestFile(root, base.projectId))).toEqual(liveManifest);
    expect(await readFile(briefFile(root, base.projectId))).toEqual(liveBrief);

    await rm(path.join(projectDir, '.project-write-v3.json'));
    await rm(path.join(projectDir, manifestTemporaryFile));
    await rm(path.join(projectDir, briefTemporaryFile));
    const recovered = createCreativeStudioPilotStoreV4(deterministicOptions(root));
    expect(await recovered.loadProjectV4(base.projectId)).toEqual(await base.store.loadProjectV4(base.projectId));
  });

  it('enforces revision authority and emits only after the correlated commit is durable', async () => {
    const root = await temporaryRoot();
    const steps: StudioPilotStorageStepV4[] = [];
    const store = createCreativeStudioPilotStoreV4(
      deterministicOptions(root, {
        onStorageStep: (step) => steps.push(step),
      })
    );
    const created = await store.createProjectV4({ name: 'Authority', brief: '' });
    const observations: Array<{ event: string; lastStep: StudioPilotStorageStepV4 | undefined }> = [];
    store.watchProjectsV4((event) => observations.push({ event: event.operation, lastStep: steps.at(-1) }));

    const authored = await store.updateProjectV4(created.id, (project) => ({ ...project, name: 'Authority renamed' }), {
      expectedRevision: created.revision,
      kind: 'authoring',
    });
    expect(authored).toMatchObject({ revision: 2, authoringRevision: 2, name: 'Authority renamed' });
    expect(observations).toEqual([{ event: 'updated', lastStep: 'update:complete' }]);
    await expectStoreError(
      store.updateProjectV4(created.id, (project) => project, {
        expectedRevision: created.revision,
        kind: 'runtime',
      }),
      'stale_project'
    );
    expect(observations).toHaveLength(1);

    const runtime = await store.withProjectAuthorityV4(created.id, async (authority) => {
      await authority.assertCurrent();
      return authority.commit((project) => project, {
        expectedRevision: authority.project.revision,
        kind: 'runtime',
      });
    });
    expect(runtime).toMatchObject({ revision: 3, authoringRevision: 2 });
    expect(observations.at(-1)).toEqual({ event: 'updated', lastStep: 'update:complete' });
    await expectStoreError(
      store.updateProjectV4(runtime.id, (project) => ({ ...project, name: 'Disguised authored edit' }), {
        expectedRevision: runtime.revision,
        kind: 'runtime',
      }),
      'invalid_payload'
    );
    await expect(store.loadProjectV4(runtime.id)).resolves.toMatchObject({
      revision: 3,
      authoringRevision: 2,
      name: 'Authority renamed',
    });
  });

  it('propagates intentional authority callback refusals without rewriting them as storage failures', async () => {
    const root = await temporaryRoot();
    const { store, projectId } = await createHealthy(root);
    const refusal = Object.assign(new Error('stale_quote'), { code: 'stale_quote' as const });

    await expect(
      store.withProjectAuthorityV4(projectId, async () => {
        throw refusal;
      })
    ).rejects.toBe(refusal);
    expect((await store.loadProjectV4(projectId)).revision).toBe(1);
  });

  it('does not notify a failed pre-journal update and leaves the prior state loadable', async () => {
    const root = await temporaryRoot();
    const base = await createHealthy(root);
    const events: unknown[] = [];
    const failing = createCreativeStudioPilotStoreV4(
      deterministicOptions(root, {
        createProjectId: () => 'unused_project',
        onStorageStep: (step) => {
          if (step === 'update:candidates_durable') throw new Error('write interrupted before journal');
        },
      })
    );
    failing.watchProjectsV4((event) => events.push(event));
    const before = await failing.loadProjectV4(base.projectId);
    await expectStoreError(
      failing.updateProjectV4(base.projectId, (project) => ({ ...project, brief: 'Must not commit' }), {
        expectedRevision: before.revision,
        kind: 'authoring',
      }),
      'storage_error'
    );
    expect(events).toEqual([]);

    const restarted = createCreativeStudioPilotStoreV4(deterministicOptions(root));
    expect(await restarted.loadProjectV4(base.projectId)).toEqual(before);
  });

  it('accepts an exact create envelope cap and refuses one byte below it without allocating residue', async () => {
    const measuredRoot = await temporaryRoot();
    const measuredStore = createCreativeStudioPilotStoreV4(deterministicOptions(measuredRoot));
    const measured = await measuredStore.createProjectV4({ name: 'Create boundary', brief: '' });
    const exactBytes = (await readFile(manifestFile(measuredRoot, measured.id))).byteLength;

    const exactRoot = await temporaryRoot();
    const exactStore = createCreativeStudioPilotStoreV4(
      deterministicOptions(exactRoot, { maxManifestBytes: exactBytes })
    );
    const exact = await exactStore.createProjectV4({ name: 'Create boundary', brief: '' });
    expect((await readFile(manifestFile(exactRoot, exact.id))).byteLength).toBe(exactBytes);

    const refusedRoot = await temporaryRoot();
    const createTemporaryId = vi.fn(() => 'temporary_00000001');
    const storageSteps: StudioPilotStorageStepV4[] = [];
    const refusedStore = createCreativeStudioPilotStoreV4(
      deterministicOptions(refusedRoot, {
        maxManifestBytes: exactBytes - 1,
        createTemporaryId,
        onStorageStep: (step) => {
          storageSteps.push(step);
        },
      })
    );
    await expectStoreError(refusedStore.createProjectV4({ name: 'Create boundary', brief: '' }), 'invalid_payload');
    expect(createTemporaryId).not.toHaveBeenCalled();
    expect(storageSteps).toEqual([]);
    expect(await readdir(refusedRoot)).toEqual([]);
  });

  it('accepts an update exactly at the envelope cap and refuses cap plus one before authorization', async () => {
    const measuredRoot = await temporaryRoot();
    const measuredStore = createCreativeStudioPilotStoreV4(deterministicOptions(measuredRoot));
    const measured = await measuredStore.createProjectV4({ name: 'Update boundary', brief: '' });
    const measuredAtCap = await updateWithRuleText(measuredStore, measured.id, measured.revision, 'x'.repeat(40));
    const exactBytes = (await readFile(manifestFile(measuredRoot, measured.id))).byteLength;
    await updateWithRuleText(measuredStore, measured.id, measuredAtCap.revision, 'x'.repeat(41));
    expect((await readFile(manifestFile(measuredRoot, measured.id))).byteLength).toBe(exactBytes + 1);

    const exactRoot = await temporaryRoot();
    const exactStore = createCreativeStudioPilotStoreV4(
      deterministicOptions(exactRoot, { maxManifestBytes: exactBytes })
    );
    const exact = await exactStore.createProjectV4({ name: 'Update boundary', brief: '' });
    await updateWithRuleText(exactStore, exact.id, exact.revision, 'x'.repeat(40));
    expect((await readFile(manifestFile(exactRoot, exact.id))).byteLength).toBe(exactBytes);

    const refusedRoot = await temporaryRoot();
    const storageSteps: StudioPilotStorageStepV4[] = [];
    const authorizeBeforeReplace = vi.fn();
    const refusedStore = createCreativeStudioPilotStoreV4(
      deterministicOptions(refusedRoot, {
        maxManifestBytes: exactBytes,
        onStorageStep: (step) => {
          storageSteps.push(step);
        },
      })
    );
    const before = await refusedStore.createProjectV4({ name: 'Update boundary', brief: '' });
    storageSteps.length = 0;
    await expectStoreError(
      updateWithRuleText(refusedStore, before.id, before.revision, 'x'.repeat(41), authorizeBeforeReplace),
      'invalid_payload'
    );
    expect(authorizeBeforeReplace).not.toHaveBeenCalled();
    expect(storageSteps).toEqual([]);
    expect((await readdir(projectDirectory(refusedRoot, before.id))).toSorted()).toEqual(['brief.md', 'project.json']);
    const restarted = createCreativeStudioPilotStoreV4(
      deterministicOptions(refusedRoot, { maxManifestBytes: exactBytes })
    );
    expect(await restarted.loadProjectV4(before.id)).toEqual(before);
  });

  it('refuses an oversized update before authorization or filesystem mutation', async () => {
    const root = await temporaryRoot();
    const storageSteps: StudioPilotStorageStepV4[] = [];
    const options = deterministicOptions(root, {
      maxManifestBytes: 2_048,
      onStorageStep: (step) => {
        storageSteps.push(step);
      },
    });
    const store = createCreativeStudioPilotStoreV4(options);
    const created = await store.createProjectV4({ name: 'Bounded manifest', brief: 'Original brief.' });
    storageSteps.length = 0;
    const authorizeBeforeReplace = vi.fn();

    await expectStoreError(
      store.updateProjectV4(
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

    const restarted = createCreativeStudioPilotStoreV4(deterministicOptions(root));
    expect(await restarted.loadProjectV4(created.id)).toEqual(created);
  });

  it('fails closed across invalid public authority requests and isolates unreadable projects', async () => {
    const root = await temporaryRoot();
    const { store, projectId } = await createHealthy(root);
    await writeRawProject(root, 'legacy', { schemaVersion: 4 });

    await expectStoreError(store.getProjectV4('../escape'), 'invalid_payload');
    await expectStoreError(store.loadProjectV4('missing'), 'not_found');
    await expectStoreError(
      store.updateProjectV4('missing', (project) => project, { kind: 'runtime' }),
      'not_found'
    );
    await expectStoreError(
      store.updateProjectV4('legacy', (project) => project, { kind: 'runtime' }),
      'unsupported'
    );
    await expectStoreError(
      store.updateProjectV4(projectId, (project) => project, { kind: 'wrong' } as never),
      'invalid_payload'
    );
    await expectStoreError(
      store.updateProjectV4(projectId, (project) => ({ ...project, id: 'changed' }), { kind: 'authoring' }),
      'invalid_payload'
    );
    await expectStoreError(
      store.withProjectAuthorityV4('missing', async () => undefined),
      'not_found'
    );
    await expectStoreError(
      store.withProjectAuthorityV4('legacy', async () => undefined),
      'unsupported'
    );
    await expectStoreError(store.withProjectAuthorityV4(projectId, null as never), 'invalid_payload');
    await expectStoreError(store.issueDeletionClaimV4('missing'), 'not_found');
    await expectStoreError(store.issueDeletionClaimV4(projectId), 'invalid_payload');
    await expectStoreError(store.issueDeletionClaimV4('../escape'), 'invalid_payload');
    await expectStoreError(store.deleteProjectV4(projectId, {} as never), 'invalid_payload');
    await expectStoreError(store.deleteProjectV4('legacy', { expectedRevision: 1 }), 'invalid_payload');
    await expectStoreError(store.deleteProjectV4('../escape', { expectedRevision: 1 }), 'invalid_payload');

    const unsubscribe = store.watchProjectsV4(() => {
      throw new Error('observer failure cannot roll back a commit');
    });
    const before = await store.loadProjectV4(projectId);
    await expect(
      store.updateProjectV4(projectId, (project) => project, {
        expectedRevision: before.revision,
        kind: 'runtime',
      })
    ).resolves.toMatchObject({ revision: before.revision + 1 });
    unsubscribe();
    await expect(() => store.watchProjectsV4(null as never)).toThrowError(CreativeStudioPilotStoreErrorV4);
    store.close();
    store.close();
    await expect(() => store.watchProjectsV4(() => undefined)).toThrowError(CreativeStudioPilotStoreErrorV4);
    await expectStoreError(store.getProjectV4(projectId), 'storage_error');
  });

  it('uses safe production defaults and rejects invalid minted ids, clocks, and temporary ids', async () => {
    expect(STUDIO_MAX_PROJECT_MANIFEST_BYTES_V4).toBe(1_048_576);
    const defaultRoot = await temporaryRoot();
    const defaults = createCreativeStudioPilotStoreV4({ rootDir: defaultRoot });
    const created = await defaults.createProjectV4({ name: 'Default authority', brief: '' });
    expect(created.id).toMatch(/^project_[A-Za-z0-9_-]+$/);
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const badProjectRoot = await temporaryRoot();
    const badProject = createCreativeStudioPilotStoreV4(
      deterministicOptions(badProjectRoot, { createProjectId: () => '../renderer-path' })
    );
    await expectStoreError(badProject.createProjectV4({ name: 'Bad id', brief: '' }), 'storage_error');

    const badClockRoot = await temporaryRoot();
    const badClock = createCreativeStudioPilotStoreV4(
      deterministicOptions(badClockRoot, { now: () => 'not-a-timestamp' })
    );
    await expectStoreError(badClock.createProjectV4({ name: 'Bad clock', brief: '' }), 'storage_error');

    const badTemporaryRoot = await temporaryRoot();
    const badTemporary = createCreativeStudioPilotStoreV4(
      deterministicOptions(badTemporaryRoot, { createTemporaryId: () => 'bad' })
    );
    await expectStoreError(badTemporary.createProjectV4({ name: 'Bad temp', brief: '' }), 'storage_error');

    const duplicateRoot = await temporaryRoot();
    const duplicate = createCreativeStudioPilotStoreV4(
      deterministicOptions(duplicateRoot, { createProjectId: () => 'same_project' })
    );
    await duplicate.createProjectV4({ name: 'First', brief: '' });
    await expectStoreError(duplicate.createProjectV4({ name: 'Second', brief: '' }), 'already_exists');

    expect(() =>
      createCreativeStudioPilotStoreV4(
        deterministicOptions(defaultRoot, { maxManifestBytes: STUDIO_MAX_PROJECT_MANIFEST_BYTES_V4 })
      )
    ).not.toThrow();
    for (const maxManifestBytes of [0, 1.5, STUDIO_MAX_PROJECT_MANIFEST_BYTES_V4 + 1]) {
      expect(() =>
        createCreativeStudioPilotStoreV4(deterministicOptions(defaultRoot, { maxManifestBytes }))
      ).toThrowError(TypeError);
    }
  });

  it('isolates an invalid durable deletion marker instead of disabling inventory', async () => {
    const root = await temporaryRoot();
    const projectsRoot = root;
    await mkdir(projectsRoot, { recursive: true });
    await writeFile(path.join(projectsRoot, '.delete-invalid.json'), '{not-json', 'utf8');
    const store = createCreativeStudioPilotStoreV4(deterministicOptions(root));

    expect(await store.inspectProjectsV4()).toEqual({
      healthyProjectIds: [],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    });
    expect((await readdir(projectsRoot)).some((entry) => entry.startsWith('.invalid-'))).toBe(true);
  });
});
