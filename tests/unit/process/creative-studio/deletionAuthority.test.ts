/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { promises as nodeFs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { StudioProjectV2 } from '@/common/types/project/creativeStudioTypes';
import { createStudioProjectManifestV2 } from '@process/services/creative-studio/service/briefFile';
import { createEmptyStudioProjectV2 } from '@process/services/creative-studio/service/schema2';
import {
  createStudioDeletionAuthorityV2,
  type StudioProjectDeletionMarkerV2,
} from '@process/services/creative-studio/store/deletionAuthority';
import { CreativeStudioStoreError } from '@process/services/creative-studio/store/contracts';
import type { StudioIdentifiedRecordV2 } from '@process/services/creative-studio/store/sidecarJournal';
import type {
  StudioDirectoryAuthorityV2,
  StudioFileIdentityV2,
  StudioProjectFileInspectionV2,
} from '@process/services/creative-studio/store/projectTransactions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
const TIMESTAMP = '2026-08-31T00:00:00.000Z';

type DeletionAuthorityDepsV2 = Parameters<typeof createStudioDeletionAuthorityV2>[0];
type SupportedInspectionV2 = Extract<StudioProjectFileInspectionV2, { status: 'supported' }>;

const isNodeError = (error: unknown, code: string): boolean =>
  error instanceof Error && 'code' in error && error.code === code;

const identityOf = (stats: Awaited<ReturnType<typeof nodeFs.lstat>>): StudioFileIdentityV2 => ({
  dev: Number(stats.dev),
  ino: Number(stats.ino),
});

const sameIdentity = (left: StudioFileIdentityV2, right: StudioFileIdentityV2): boolean =>
  left.dev === right.dev && left.ino === right.ino;

const sha256Utf8 = (bytes: string): string => createHash('sha256').update(bytes, 'utf8').digest('hex');

const markerBytes = (marker: StudioProjectDeletionMarkerV2): string => JSON.stringify(marker, null, 2);

describe('Creative Studio project deletion authority', () => {
  let root: string;
  let inspection: StudioProjectFileInspectionV2;
  let deps: DeletionAuthorityDepsV2;

  const captureDirectoryAuthority = async (directory: string): Promise<StudioDirectoryAuthorityV2> => {
    const stats = await nodeFs.lstat(directory);
    if (stats.isSymbolicLink() || !stats.isDirectory() || (await nodeFs.realpath(directory)) !== directory) {
      throw new CreativeStudioStoreError('storage_error', 'Test directory authority changed');
    }
    return { path: directory, ...identityOf(stats) };
  };

  const assertDirectoryAuthority = async (authority: StudioDirectoryAuthorityV2): Promise<void> => {
    const current = await captureDirectoryAuthority(authority.path);
    if (!sameIdentity(current, authority)) {
      throw new CreativeStudioStoreError('storage_error', 'Test directory authority changed');
    }
  };

  const assertPathAbsent = async (file: string): Promise<void> => {
    try {
      await nodeFs.lstat(file);
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return;
      throw error;
    }
    throw new CreativeStudioStoreError('storage_error', 'Test path unexpectedly exists');
  };

  const assertIdentifiedRecordCurrent = async (input: {
    identified: StudioIdentifiedRecordV2<unknown>;
  }): Promise<void> => {
    const [bytes, stats] = await Promise.all([
      nodeFs.readFile(input.identified.file, 'utf8'),
      nodeFs.lstat(input.identified.file),
    ]);
    if (bytes !== input.identified.bytes || !sameIdentity(identityOf(stats), input.identified.identity)) {
      throw new CreativeStudioStoreError('storage_error', 'Test identified record changed');
    }
  };

  const publishImmutableJournalRecord = async (input: {
    file: string;
    bytes: string;
    authorizeBeforeLink?: (temporary: StudioIdentifiedRecordV2<null>) => Promise<void>;
    retainTemporary?: boolean;
  }): Promise<void> => {
    const temporaryFile = `${input.file}.publish`;
    await nodeFs.writeFile(temporaryFile, input.bytes, { encoding: 'utf8', flag: 'wx' });
    const temporaryStats = await nodeFs.lstat(temporaryFile);
    await input.authorizeBeforeLink?.({
      file: temporaryFile,
      bytes: input.bytes,
      identity: identityOf(temporaryStats),
      record: null,
      quarantined: false,
    });
    await nodeFs.link(temporaryFile, input.file);
    if (input.retainTemporary !== true) await nodeFs.rm(temporaryFile);
  };

  const makeProject = (projectId: string): StudioProjectV2 =>
    createEmptyStudioProjectV2(
      {
        name: 'Deletion proof',
        brief: 'A project whose exact tree is deletion authority.',
        aspectRatio: '16:9',
        targetDurationSeconds: 30,
        resolution: '1080p',
      },
      projectId,
      TIMESTAMP
    );

  const seedProject = async (
    projectId: string,
    options: { nestedTree?: boolean } = {}
  ): Promise<SupportedInspectionV2> => {
    const project = makeProject(projectId);
    const directory = path.join(root, projectId);
    await nodeFs.mkdir(directory);
    const bytes = JSON.stringify(createStudioProjectManifestV2(project), null, 2);
    const projectFile = path.join(directory, 'project.json');
    await Promise.all([
      nodeFs.writeFile(projectFile, bytes),
      nodeFs.writeFile(path.join(directory, 'brief.md'), project.brief),
    ]);
    if (options.nestedTree === true) {
      const nested = path.join(directory, 'assets', 'nested');
      await nodeFs.mkdir(nested, { recursive: true });
      await nodeFs.writeFile(path.join(nested, 'frame.bin'), 'frame');
      const outside = path.join(root, 'outside.txt');
      await nodeFs.writeFile(outside, 'preserve me');
      await nodeFs.symlink(outside, path.join(directory, 'outside-link'));
    }
    const [directoryStats, projectStats] = await Promise.all([nodeFs.lstat(directory), nodeFs.lstat(projectFile)]);
    return {
      status: 'supported',
      project,
      bytes,
      identity: identityOf(projectStats),
      directory: { path: directory, ...identityOf(directoryStats) },
      briefFile: {
        status: 'present',
        bytes: project.brief,
        identity: identityOf(await nodeFs.lstat(path.join(directory, 'brief.md'))),
      },
      briefSynchronized: true,
    };
  };

  const deletionMarker = (
    snapshot: SupportedInspectionV2,
    overrides: Partial<StudioProjectDeletionMarkerV2> = {}
  ): StudioProjectDeletionMarkerV2 => ({
    schemaVersion: 1,
    projectId: snapshot.project.id,
    expectedRevision: snapshot.project.revision,
    directoryDev: snapshot.directory.dev,
    directoryIno: snapshot.directory.ino,
    projectSha256: sha256Utf8(snapshot.bytes),
    ...overrides,
  });

  const rewriteSnapshotProject = async (
    snapshot: SupportedInspectionV2,
    project: StudioProjectV2
  ): Promise<SupportedInspectionV2> => {
    const projectFile = path.join(snapshot.directory.path, 'project.json');
    const bytes = JSON.stringify(createStudioProjectManifestV2(project), null, 2);
    await nodeFs.writeFile(projectFile, bytes);
    return {
      ...snapshot,
      project,
      bytes,
      identity: identityOf(await nodeFs.lstat(projectFile)),
    };
  };

  const writeMarker = async (
    marker: StudioProjectDeletionMarkerV2,
    mode: 'committed' | 'final_only' = 'committed'
  ): Promise<void> => {
    const file = path.join(root, `.delete-${marker.projectId}.json`);
    const bytes = markerBytes(marker);
    if (mode === 'final_only') {
      await nodeFs.writeFile(file, bytes);
      return;
    }
    await nodeFs.writeFile(`${file}.publish`, bytes);
    await nodeFs.link(`${file}.publish`, file);
  };

  const cleanupDirectory = (marker: StudioProjectDeletionMarkerV2): string =>
    path.join(root, `.delete-cleanup-${sha256Utf8(markerBytes(marker))}`);

  beforeEach(async () => {
    root = await nodeFs.realpath(await nodeFs.mkdtemp(path.join(tmpdir(), 'studio-deletion-authority-')));
    inspection = { status: 'not_found', projectId: 'unset' };
    deps = {
      fs: nodeFs,
      maxProjectBytes: MAX_PROJECT_BYTES,
      resolveRootChild: (canonicalRoot, child) => path.join(canonicalRoot, child),
      captureDirectoryAuthority,
      assertDirectoryAuthority,
      syncDirectoryAuthority: vi.fn(async (): Promise<void> => undefined),
      sameIdentity,
      assertPathAbsent,
      assertProjectSnapshotCurrent: async ({ snapshot }) => {
        const [bytes, stats] = await Promise.all([
          nodeFs.readFile(path.join(snapshot.directory.path, 'project.json'), 'utf8'),
          nodeFs.lstat(path.join(snapshot.directory.path, 'project.json')),
        ]);
        if (bytes !== snapshot.bytes || !sameIdentity(identityOf(stats), snapshot.identity)) {
          throw new CreativeStudioStoreError('storage_error', 'Test project snapshot changed');
        }
        await assertDirectoryAuthority(snapshot.directory);
      },
      assertIdentifiedRecordCurrent,
      publishImmutableJournalRecord,
      inspectProjectFile: vi.fn(async (): Promise<StudioProjectFileInspectionV2> => inspection),
      requireSupportedProjectInspection: (inspected) => {
        if (inspected.status === 'supported') return inspected;
        if (inspected.status === 'not_found') {
          throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        }
        if (inspected.status === 'unsupported_prototype_schema') {
          throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
        }
        throw inspected.error;
      },
      summariesFile: vi.fn(async () => path.join(root, 'projects-v2.json')),
      storageError: (error, fallback) =>
        new CreativeStudioStoreError('storage_error', error instanceof Error ? error.message : fallback),
    };
  });

  afterEach(async () => {
    await nodeFs.rm(root, { recursive: true, force: true });
  });

  it('deletes an exact nested project tree while preserving a symlink target outside it', async () => {
    const snapshot = await seedProject('project_nested', { nestedTree: true });
    inspection = snapshot;
    const authority = createStudioDeletionAuthorityV2(deps);

    await expect(
      authority.deleteSupportedProjectV2InsideQueue(root, snapshot, snapshot.project.revision)
    ).resolves.toBe(true);

    await expect(nodeFs.lstat(snapshot.directory.path)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(nodeFs.readFile(path.join(root, 'outside.txt'), 'utf8')).resolves.toBe('preserve me');
    await expect(nodeFs.lstat(path.join(root, `.delete-${snapshot.project.id}.json`))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(nodeFs.lstat(path.join(root, `.delete-${snapshot.project.id}.json.publish`))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refuses active work, a stale revision, and an existing quarantine before publishing a marker', async () => {
    const snapshot = await seedProject('project_refusals');
    inspection = snapshot;
    const authority = createStudioDeletionAuthorityV2(deps);
    const busy = {
      ...snapshot,
      project: {
        ...snapshot.project,
        jobs: { running_job: { status: 'running' } },
      } as unknown as StudioProjectV2,
    };

    await expect(
      authority.deleteSupportedProjectV2InsideQueue(root, busy, busy.project.revision)
    ).rejects.toMatchObject({
      code: 'busy',
      message: 'Studio project has active generation jobs',
    });
    await expect(
      authority.deleteSupportedProjectV2InsideQueue(root, snapshot, snapshot.project.revision + 1)
    ).rejects.toMatchObject({ code: 'stale_project', message: 'Studio project has changed' });

    const paths = authority.projectDeletionPathsV2(root, snapshot.project.id);
    await nodeFs.mkdir(paths.quarantineDirectory);
    await expect(
      authority.deleteSupportedProjectV2InsideQueue(root, snapshot, snapshot.project.revision)
    ).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Studio project deletion quarantine already exists',
    });
    await expect(nodeFs.lstat(paths.markerFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('classifies absent, final-only, and committed markers without inventing deletion authority', async () => {
    const snapshot = await seedProject('project_marker_states');
    const marker = deletionMarker(snapshot);
    const authority = createStudioDeletionAuthorityV2(deps);

    await expect(authority.readProjectDeletionMarkerV2(root, snapshot.project.id)).resolves.toBeNull();
    await writeMarker(marker, 'final_only');
    await expect(authority.readProjectDeletionMarkerV2(root, snapshot.project.id)).resolves.toMatchObject({
      record: marker,
      quarantined: true,
    });
    await nodeFs.rm(path.join(root, `.delete-${snapshot.project.id}.json`));
    await writeMarker(marker);
    await expect(authority.readProjectDeletionMarkerV2(root, snapshot.project.id)).resolves.toMatchObject({
      record: marker,
      quarantined: false,
    });
  });

  it('promotes an exact retained publication when an explicit delete is retried', async () => {
    const snapshot = await seedProject('project_exact_retry');
    inspection = snapshot;
    const marker = deletionMarker(snapshot);
    const authority = createStudioDeletionAuthorityV2(deps);
    await nodeFs.writeFile(path.join(root, `.delete-${snapshot.project.id}.json.publish`), markerBytes(marker));

    await expect(
      authority.deleteSupportedProjectV2InsideQueue(root, snapshot, snapshot.project.revision)
    ).resolves.toBe(true);
    await expect(nodeFs.lstat(snapshot.directory.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes an attributable older retained marker before publishing a newer deletion', async () => {
    let snapshot = await seedProject('project_stale_retry');
    snapshot = await rewriteSnapshotProject(snapshot, {
      ...snapshot.project,
      revision: snapshot.project.revision + 1,
      updatedAt: '2026-08-31T00:00:01.000Z',
    });
    inspection = snapshot;
    const marker = deletionMarker(snapshot);
    const staleMarker = { ...marker, expectedRevision: marker.expectedRevision - 1 };
    const authority = createStudioDeletionAuthorityV2(deps);
    await nodeFs.writeFile(path.join(root, `.delete-${snapshot.project.id}.json.publish`), markerBytes(staleMarker));

    await expect(
      authority.deleteSupportedProjectV2InsideQueue(root, snapshot, snapshot.project.revision)
    ).resolves.toBe(true);
    await expect(nodeFs.lstat(snapshot.directory.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an ambiguous publication and malformed marker families', async () => {
    const snapshot = await seedProject('project_bad_markers');
    const marker = deletionMarker(snapshot);
    const authority = createStudioDeletionAuthorityV2(deps);
    const file = path.join(root, `.delete-${snapshot.project.id}.json`);

    await nodeFs.writeFile(file, markerBytes(marker));
    await nodeFs.writeFile(`${file}.publish`, `${markerBytes(marker)} `);
    await expect(authority.readProjectDeletionMarkerV2(root, snapshot.project.id)).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Studio project deletion marker publication is ambiguous',
    });

    await Promise.all([nodeFs.rm(file), nodeFs.rm(`${file}.publish`)]);
    const malformedValues: unknown[] = [
      '{',
      null,
      { ...marker, extra: true },
      { ...marker, schemaVersion: 2 },
      { ...marker, projectId: 'wrong_project' },
      { ...marker, projectId: 'unsafe/project' },
      { ...marker, projectId: 'p'.repeat(257) },
      { ...marker, expectedRevision: 0 },
      { ...marker, expectedRevision: 1.5 },
      { ...marker, directoryDev: -1 },
      { ...marker, directoryDev: '0' },
      { ...marker, directoryIno: -1 },
      { ...marker, projectSha256: null },
      { ...marker, projectSha256: 'A'.repeat(64) },
    ];
    for (const value of malformedValues) {
      // eslint-disable-next-line no-await-in-loop -- each malformed record owns the same fixed marker name.
      await nodeFs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
      // eslint-disable-next-line no-await-in-loop -- each malformed record owns the same fixed marker name.
      await expect(authority.readProjectDeletionMarkerV2(root, snapshot.project.id)).rejects.toMatchObject({
        code: 'storage_error',
        message: 'Studio project deletion marker is malformed',
      });
      // eslint-disable-next-line no-await-in-loop -- each malformed record owns the same fixed marker name.
      await nodeFs.rm(file);
    }
  });

  it('finishes marker-only recovery after the project tree was already removed', async () => {
    const snapshot = await seedProject('project_marker_only');
    const marker = deletionMarker(snapshot);
    const authority = createStudioDeletionAuthorityV2(deps);
    await nodeFs.rm(snapshot.directory.path, { recursive: true });
    inspection = { status: 'not_found', projectId: snapshot.project.id };
    await writeMarker(marker, 'final_only');
    const identified = await authority.readProjectDeletionMarkerV2(root, snapshot.project.id);

    await expect(authority.finishProjectDeletionV2(root, identified!)).resolves.toBeUndefined();
    await expect(nodeFs.lstat(path.join(root, `.delete-${snapshot.project.id}.json`))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refuses a final-only marker while any companion tree still exists', async () => {
    const snapshot = await seedProject('project_missing_companion');
    const marker = deletionMarker(snapshot);
    const authority = createStudioDeletionAuthorityV2(deps);
    await writeMarker(marker, 'final_only');
    const identified = await authority.readProjectDeletionMarkerV2(root, snapshot.project.id);

    await expect(authority.finishProjectDeletionV2(root, identified!)).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Studio project deletion marker companion is missing',
    });
  });

  it('rejects unsafe and missing deletion companions before inspecting a project', async () => {
    const quarantineSnapshot = await seedProject('project_unsafe_quarantine');
    const quarantineMarker = deletionMarker(quarantineSnapshot);
    const authority = createStudioDeletionAuthorityV2(deps);
    await writeMarker(quarantineMarker);
    const quarantineIdentified = await authority.readProjectDeletionMarkerV2(root, quarantineSnapshot.project.id);
    await nodeFs.writeFile(
      authority.projectDeletionPathsV2(root, quarantineSnapshot.project.id).quarantineDirectory,
      'not a directory'
    );
    await expect(authority.finishProjectDeletionV2(root, quarantineIdentified!)).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Studio project deletion quarantine is unsafe',
    });

    const cleanupSnapshot = await seedProject('project_unsafe_cleanup');
    const cleanupMarker = deletionMarker(cleanupSnapshot);
    await writeMarker(cleanupMarker);
    const cleanupIdentified = await authority.readProjectDeletionMarkerV2(root, cleanupSnapshot.project.id);
    await nodeFs.writeFile(cleanupDirectory(cleanupMarker), 'not a directory');
    await expect(authority.finishProjectDeletionV2(root, cleanupIdentified!)).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Studio project deletion cleanup claim is unsafe',
    });

    const missingSnapshot = await seedProject('project_final_missing_companion');
    const missingMarker = deletionMarker(missingSnapshot);
    const missingPaths = authority.projectDeletionPathsV2(root, missingSnapshot.project.id);
    await nodeFs.rename(missingSnapshot.directory.path, missingPaths.quarantineDirectory);
    await writeMarker(missingMarker, 'final_only');
    const missingIdentified = await authority.readProjectDeletionMarkerV2(root, missingSnapshot.project.id);
    await expect(authority.finishProjectDeletionV2(root, missingIdentified!)).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Studio project deletion marker companion is missing',
    });
  });

  it('rejects a missing classification for a live target and a changed supported snapshot', async () => {
    const missingSnapshot = await seedProject('project_target_mismatch');
    const authority = createStudioDeletionAuthorityV2(deps);
    await writeMarker(deletionMarker(missingSnapshot));
    const missingIdentified = await authority.readProjectDeletionMarkerV2(root, missingSnapshot.project.id);
    inspection = { status: 'not_found', projectId: missingSnapshot.project.id };
    await expect(authority.finishProjectDeletionV2(root, missingIdentified!)).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Studio project deletion target changed',
    });

    const changedSnapshot = await seedProject('project_snapshot_mismatch');
    const changedMarker = deletionMarker(changedSnapshot, {
      expectedRevision: changedSnapshot.project.revision + 1,
    });
    await writeMarker(changedMarker);
    const changedIdentified = await authority.readProjectDeletionMarkerV2(root, changedSnapshot.project.id);
    inspection = changedSnapshot;
    await expect(authority.finishProjectDeletionV2(root, changedIdentified!)).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Studio project changed during deletion',
    });
  });

  it('resumes an exact cleanup claim and removes its complete tree', async () => {
    const snapshot = await seedProject('project_cleanup_resume', { nestedTree: true });
    const marker = deletionMarker(snapshot);
    const authority = createStudioDeletionAuthorityV2(deps);
    const claim = cleanupDirectory(marker);
    await nodeFs.rename(snapshot.directory.path, claim);
    await writeMarker(marker);
    const identified = await authority.readProjectDeletionMarkerV2(root, snapshot.project.id);

    await expect(authority.finishProjectDeletionV2(root, identified!)).resolves.toBeUndefined();
    await expect(nodeFs.lstat(claim)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(nodeFs.readFile(path.join(root, 'outside.txt'), 'utf8')).resolves.toBe('preserve me');
  });

  it('rejects simultaneous quarantine and cleanup claims', async () => {
    const snapshot = await seedProject('project_ambiguous_claim');
    const marker = deletionMarker(snapshot);
    const authority = createStudioDeletionAuthorityV2(deps);
    const quarantine = authority.projectDeletionPathsV2(root, snapshot.project.id).quarantineDirectory;
    await nodeFs.rename(snapshot.directory.path, quarantine);
    await nodeFs.mkdir(cleanupDirectory(marker));
    await writeMarker(marker);
    const identified = await authority.readProjectDeletionMarkerV2(root, snapshot.project.id);

    await expect(authority.finishProjectDeletionV2(root, identified!)).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Studio project deletion cleanup authority is ambiguous',
    });
  });

  it('restores a foreign quarantine to the live name before refusing its identity', async () => {
    const snapshot = await seedProject('project_foreign_quarantine');
    const marker = deletionMarker(snapshot);
    const authority = createStudioDeletionAuthorityV2(deps);
    const paths = authority.projectDeletionPathsV2(root, snapshot.project.id);
    await nodeFs.rm(snapshot.directory.path, { recursive: true });
    await nodeFs.mkdir(paths.quarantineDirectory);
    await nodeFs.writeFile(path.join(paths.quarantineDirectory, 'foreign.txt'), 'foreign');
    await writeMarker(marker);
    const identified = await authority.readProjectDeletionMarkerV2(root, snapshot.project.id);

    await expect(authority.finishProjectDeletionV2(root, identified!)).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Studio project deletion quarantine changed',
    });
    await expect(nodeFs.readFile(path.join(paths.projectDirectory, 'foreign.txt'), 'utf8')).resolves.toBe('foreign');
  });

  it('rejects a changed quarantined manifest before claiming recursive cleanup', async () => {
    const snapshot = await seedProject('project_changed_manifest');
    const marker = deletionMarker(snapshot, { projectSha256: '0'.repeat(64) });
    const authority = createStudioDeletionAuthorityV2(deps);
    const paths = authority.projectDeletionPathsV2(root, snapshot.project.id);
    await nodeFs.rename(snapshot.directory.path, paths.quarantineDirectory);
    await writeMarker(marker);
    const identified = await authority.readProjectDeletionMarkerV2(root, snapshot.project.id);

    await expect(authority.finishProjectDeletionV2(root, identified!)).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Studio project deletion quarantine manifest changed',
    });
    await expect(nodeFs.lstat(paths.quarantineDirectory)).resolves.toMatchObject({});
  });

  it.each([
    ['malformed JSON', '{'],
    ['a well-formed non-project', '{}'],
  ])('rejects %s in an otherwise attributable quarantine', async (_label, manifestBytes) => {
    const projectId = `project_bad_quarantine_${sha256Utf8(manifestBytes).slice(0, 8)}`;
    const snapshot = await seedProject(projectId);
    const authority = createStudioDeletionAuthorityV2(deps);
    const paths = authority.projectDeletionPathsV2(root, projectId);
    await nodeFs.rename(snapshot.directory.path, paths.quarantineDirectory);
    await nodeFs.writeFile(path.join(paths.quarantineDirectory, 'project.json'), manifestBytes);
    const marker = deletionMarker(snapshot, { projectSha256: sha256Utf8(manifestBytes) });
    await writeMarker(marker);
    const identified = await authority.readProjectDeletionMarkerV2(root, projectId);

    await expect(authority.finishProjectDeletionV2(root, identified!)).rejects.toMatchObject({
      code: 'storage_error',
      message:
        manifestBytes === '{'
          ? 'Studio project deletion quarantine manifest is malformed'
          : 'Studio project deletion quarantine manifest changed',
    });
  });

  it('rejects a quarantined project whose separately authoritative Brief is missing', async () => {
    const snapshot = await seedProject('project_missing_quarantine_brief');
    const marker = deletionMarker(snapshot);
    const authority = createStudioDeletionAuthorityV2(deps);
    const paths = authority.projectDeletionPathsV2(root, snapshot.project.id);
    await nodeFs.rename(snapshot.directory.path, paths.quarantineDirectory);
    await nodeFs.rm(path.join(paths.quarantineDirectory, 'brief.md'));
    await writeMarker(marker);
    const identified = await authority.readProjectDeletionMarkerV2(root, snapshot.project.id);

    await expect(authority.finishProjectDeletionV2(root, identified!)).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Studio project deletion quarantine manifest changed',
    });
  });
  /*
   * The two guards below are the deletion authority's time-of-check-to-time-of-use defences. It
   * captures a proof of the tree it is about to delete, then re-verifies that proof around every
   * child so a directory swapped underneath it cannot redirect the removal. Nothing exercised either
   * of them, which is the worst combination: code whose only purpose is to catch an attack that has
   * never been simulated.
   *
   * Both are reached by perturbing the INJECTED `fs` rather than by racing the real filesystem, so
   * they are deterministic. `deps.fs` exists as a dependency precisely so this is testable.
   */

  /** Replaces one directory entry name so `path.join` escapes the parent it was read from. */
  const fsWithEntryName = (targetDirectory: string, name: string): typeof nodeFs =>
    ({
      ...nodeFs,
      opendir: async (directory: Parameters<typeof nodeFs.opendir>[0]) => {
        const real = await nodeFs.opendir(directory);
        if (String(directory) !== targetDirectory) return real;
        let served = false;
        return {
          read: async () => {
            if (served) return null;
            served = true;
            return { name, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false };
          },
          close: async () => real.close(),
        } as unknown as Awaited<ReturnType<typeof nodeFs.opendir>>;
      },
    }) as typeof nodeFs;

  /** Reports a different inode for `targetPath` from the nth lstat onward: an identity swap. */
  const fsWithInodeSwap = (targetPath: string, fromCall: number): typeof nodeFs => {
    let calls = 0;
    return {
      ...nodeFs,
      lstat: async (target: Parameters<typeof nodeFs.lstat>[0]) => {
        const real = await nodeFs.lstat(target);
        if (String(target) !== targetPath) return real;
        calls += 1;
        if (calls < fromCall) return real;
        return Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
          ino: Number(real.ino) + 1,
        }) as typeof real;
      },
    } as typeof nodeFs;
  };

  it('refuses a cleanup whose directory entry would escape the parent it was read from', async () => {
    const snapshot = await seedProject('project_escaping_entry', { nestedTree: true });
    const marker = deletionMarker(snapshot);
    const claim = cleanupDirectory(marker);
    await nodeFs.rename(snapshot.directory.path, claim);
    await writeMarker(marker);

    // A real filesystem cannot produce this name, so only a compromised or emulated directory
    // handle can. The guard is the reason such a name cannot redirect a delete.
    const authority = createStudioDeletionAuthorityV2({ ...deps, fs: fsWithEntryName(claim, '../outside.txt') });
    const identified = await authority.readProjectDeletionMarkerV2(root, snapshot.project.id);

    await expect(authority.finishProjectDeletionV2(root, identified!)).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Studio project deletion cleanup path is unsafe',
    });
    await expect(nodeFs.readFile(path.join(root, 'outside.txt'), 'utf8')).resolves.toBe('preserve me');
  });

  it('refuses a cleanup whose claim directory changes identity after the marker is read', async () => {
    const snapshot = await seedProject('project_parent_swap', { nestedTree: true });
    const marker = deletionMarker(snapshot);
    const claim = cleanupDirectory(marker);
    await nodeFs.rename(snapshot.directory.path, claim);
    await writeMarker(marker);

    const authority = createStudioDeletionAuthorityV2({ ...deps, fs: fsWithInodeSwap(claim, 2) });
    const identified = await authority.readProjectDeletionMarkerV2(root, snapshot.project.id);

    await expect(authority.finishProjectDeletionV2(root, identified!)).rejects.toMatchObject({
      code: 'storage_error',
      message: 'Studio project deletion cleanup claim changed',
    });
    // The claim survives: a refused cleanup must not have started removing anything.
    await expect(nodeFs.lstat(claim)).resolves.toBeDefined();
  });
});
