/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as nodeFs, realpathSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  type CreateStudioProjectInputV2,
} from '@/common/types/project/creativeStudioTypes';
import { createCreativeStudioStore, type StudioProjectCommitFacts } from '@process/services/creative-studio/store';
import { createCreativeStudioServiceV2 } from '@process/services/creative-studio/service';

const V1_PROJECT_ID = 'project_v1';
const V2_PROJECT_ID = 'project_v2';
const FIXTURE_TIME = '2026-08-17T06:00:00.000Z';
const EXPECTED_V1_PATHS = [
  V1_PROJECT_ID,
  path.join(V1_PROJECT_ID, 'commands'),
  path.join(V1_PROJECT_ID, 'commands', 'pending'),
  path.join(V1_PROJECT_ID, 'commands', 'pending', 'command_pending.json'),
  path.join(V1_PROJECT_ID, 'commands', 'receipts'),
  path.join(V1_PROJECT_ID, 'commands', 'receipts', 'command_applied.json'),
  path.join(V1_PROJECT_ID, 'commands', 'slots'),
  path.join(V1_PROJECT_ID, 'commands', 'slots', '0.slot'),
  path.join(V1_PROJECT_ID, 'commands', 'slots', '0.slot.lease'),
  path.join(V1_PROJECT_ID, 'parts'),
  path.join(V1_PROJECT_ID, 'parts', 'abandoned-download.part'),
  path.join(V1_PROJECT_ID, 'project.json'),
  path.join(V1_PROJECT_ID, 'proposals'),
  path.join(V1_PROJECT_ID, 'proposals', 'decisions'),
  path.join(V1_PROJECT_ID, 'proposals', 'decisions', 'proposal_decided.json'),
  path.join(V1_PROJECT_ID, 'proposals', 'pending'),
  path.join(V1_PROJECT_ID, 'proposals', 'pending', 'proposal_pending.json'),
  path.join(V1_PROJECT_ID, 'proposals', 'slots'),
  path.join(V1_PROJECT_ID, 'proposals', 'slots', '0.slot'),
  path.join(V1_PROJECT_ID, 'reference-requests'),
  path.join(V1_PROJECT_ID, 'reference-requests', 'pending'),
  path.join(V1_PROJECT_ID, 'reference-requests', 'pending', 'reference_pending.json'),
  path.join(V1_PROJECT_ID, 'reference-requests', 'slots'),
  path.join(V1_PROJECT_ID, 'reference-requests', 'slots', '0.slot'),
  'projects.json',
].toSorted((left, right) => left.localeCompare(right));

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type SnapshotEntry = {
  relativePath: string;
  kind: 'directory' | 'file';
  rawBytes: string | null;
  metadataSha256: string;
};

type FsMutation = {
  method: string;
  paths: string[];
};

type ObservedFileSystem = {
  fs: typeof nodeFs;
  mutations: FsMutation[];
  clearMutations(): void;
};

const v1Project = () => ({
  schemaVersion: 1,
  revision: 4,
  id: V1_PROJECT_ID,
  name: 'Prototype project',
  brief: 'A schema-1 profile that must remain byte-for-byte unchanged.',
  rules: [],
  ruleListUndo: null,
  briefConversationId: null,
  aspectRatio: '16:9',
  targetDurationSeconds: 10,
  resolution: '1080p',
  sceneOrder: ['scene_v1'],
  scenes: {
    scene_v1: {
      id: 'scene_v1',
      title: 'Prototype scene',
      purpose: 'Exercise every legacy sidecar family',
      visualPrompt: 'A sealed archive box in a quiet studio',
      narration: '',
      onScreenText: '',
      mediaKind: 'image',
      durationSeconds: 5,
      referenceAssetId: null,
      selectedAssetId: null,
      assetIds: [],
      jobIds: [],
      reviewState: 'ready',
    },
  },
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: FIXTURE_TIME,
  updatedAt: FIXTURE_TIME,
});

const v1Summary = () => ({
  id: V1_PROJECT_ID,
  name: 'Prototype project',
  aspectRatio: '16:9',
  targetDurationSeconds: 10,
  resolution: '1080p',
  sceneCount: 1,
  selectedAssetCount: 0,
  poster: null,
  createdAt: FIXTURE_TIME,
  updatedAt: FIXTURE_TIME,
});

const jsonBytes = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const createCompleteV1Profile = async (): Promise<{ rootDir: string; projectDir: string; indexFile: string }> => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-schema2-cutover-'));
  roots.push(rootDir);
  const projectDir = path.join(rootDir, V1_PROJECT_ID);
  const directories = [
    path.join(projectDir, 'parts'),
    path.join(projectDir, 'proposals', 'pending'),
    path.join(projectDir, 'proposals', 'decisions'),
    path.join(projectDir, 'proposals', 'slots'),
    path.join(projectDir, 'reference-requests', 'pending'),
    path.join(projectDir, 'reference-requests', 'slots'),
    path.join(projectDir, 'commands', 'pending'),
    path.join(projectDir, 'commands', 'slots'),
    path.join(projectDir, 'commands', 'receipts'),
  ];
  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true })));

  const proposal = {
    schemaVersion: 1,
    id: 'proposal_pending',
    projectId: V1_PROJECT_ID,
    status: 'pending',
    baseRevision: 4,
    payload: { kind: 'pin_rule', rule: { text: 'Keep the prototype sealed', predicate: null } },
    createdAt: FIXTURE_TIME,
    decidedAt: null,
  };
  const referenceRequest = {
    schemaVersion: 1,
    id: 'reference_pending',
    projectId: V1_PROJECT_ID,
    sceneId: 'scene_v1',
    status: 'pending',
    createdAt: FIXTURE_TIME,
  };
  const command = {
    schemaVersion: 1,
    commandId: 'command_pending',
    projectId: V1_PROJECT_ID,
    expectedRevision: 4,
    createdAt: FIXTURE_TIME,
    deadlineAt: '2026-08-17T06:00:15.000Z',
    policy: 'auto_apply',
    operations: [{ kind: 'set_brief', brief: 'Do not apply this legacy command' }],
  };

  await Promise.all([
    writeFile(path.join(projectDir, 'project.json'), jsonBytes(v1Project())),
    writeFile(path.join(rootDir, 'projects.json'), jsonBytes({ schemaVersion: 1, projects: [v1Summary()] })),
    writeFile(path.join(projectDir, 'parts', 'abandoned-download.part'), Buffer.from([0, 1, 2, 3, 255])),
    writeFile(path.join(projectDir, 'proposals', 'pending', 'proposal_pending.json'), jsonBytes(proposal)),
    writeFile(
      path.join(projectDir, 'proposals', 'decisions', 'proposal_decided.json'),
      jsonBytes({
        schemaVersion: 1,
        proposalId: 'proposal_decided',
        status: 'rejected',
        decidedAt: FIXTURE_TIME,
      })
    ),
    writeFile(
      path.join(projectDir, 'proposals', 'slots', '0.slot'),
      jsonBytes({ schemaVersion: 1, proposalId: 'proposal_pending', reservedAt: FIXTURE_TIME })
    ),
    writeFile(
      path.join(projectDir, 'reference-requests', 'pending', 'reference_pending.json'),
      jsonBytes(referenceRequest)
    ),
    writeFile(
      path.join(projectDir, 'reference-requests', 'slots', '0.slot'),
      jsonBytes({ schemaVersion: 1, requestId: 'reference_pending', reservedAt: FIXTURE_TIME })
    ),
    writeFile(path.join(projectDir, 'commands', 'pending', 'command_pending.json'), jsonBytes(command)),
    writeFile(
      path.join(projectDir, 'commands', 'slots', '0.slot'),
      jsonBytes({
        schemaVersion: 1,
        commandId: 'command_pending',
        reservedAt: FIXTURE_TIME,
        deadlineAt: '2026-08-17T06:00:15.000Z',
      })
    ),
    writeFile(
      path.join(projectDir, 'commands', 'slots', '0.slot.lease'),
      jsonBytes({
        schemaVersion: 1,
        leaseId: 'lease_v1',
        owner: 'writer',
        commandId: 'command_pending',
        reservedAt: FIXTURE_TIME,
        deadlineAt: '2026-08-17T06:00:15.000Z',
        acquiredAt: FIXTURE_TIME,
        expiresAt: '2026-08-17T06:00:02.000Z',
      })
    ),
    writeFile(
      path.join(projectDir, 'commands', 'receipts', 'command_applied.json'),
      jsonBytes({
        schemaVersion: 1,
        commandId: 'command_applied',
        projectId: V1_PROJECT_ID,
        expectedRevision: 3,
        decidedAt: FIXTURE_TIME,
        status: 'applied',
        appliedRevision: 4,
        createdSceneIds: [],
      })
    ),
  ]);

  return { rootDir, projectDir, indexFile: path.join(rootDir, 'projects.json') };
};

const stableMetadataHash = async (file: string): Promise<{ kind: 'directory' | 'file'; sha256: string }> => {
  const stats = await nodeFs.lstat(file, { bigint: true });
  const kind = stats.isDirectory() ? 'directory' : 'file';
  if (!stats.isDirectory() && !stats.isFile()) throw new Error(`Unexpected V1 profile entry: ${file}`);
  const stableMetadata = [
    kind,
    stats.dev,
    stats.ino,
    stats.mode,
    stats.nlink,
    stats.uid,
    stats.gid,
    stats.rdev,
    stats.size,
    stats.blksize,
    stats.blocks,
    stats.mtimeNs,
    stats.ctimeNs,
    stats.birthtimeNs,
  ].map(String);
  return {
    kind,
    sha256: createHash('sha256').update(stableMetadata.join('\0')).digest('hex'),
  };
};

const snapshotV1Profile = async (rootDir: string): Promise<SnapshotEntry[]> => {
  const entries: SnapshotEntry[] = [];
  const visit = async (file: string): Promise<void> => {
    const metadata = await stableMetadataHash(file);
    entries.push({
      relativePath: path.relative(rootDir, file),
      kind: metadata.kind,
      rawBytes: metadata.kind === 'file' ? (await readFile(file)).toString('base64') : null,
      metadataSha256: metadata.sha256,
    });
    if (metadata.kind !== 'directory') return;
    const children = (await readdir(file)).toSorted();
    for (const child of children) {
      // The snapshot is deliberately serial so its ordering is independent of filesystem scheduling.
      // eslint-disable-next-line no-await-in-loop
      await visit(path.join(file, child));
    }
  };

  await visit(path.join(rootDir, V1_PROJECT_ID));
  await visit(path.join(rootDir, 'projects.json'));
  return entries.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
};

const asPath = (value: unknown): string | null => {
  if (typeof value === 'string') return path.resolve(value);
  if (Buffer.isBuffer(value)) return path.resolve(value.toString());
  if (value instanceof URL) return path.resolve(fileURLToPath(value));
  return null;
};

const isWriteCapableOpen = (flags: string | number): boolean => {
  if (typeof flags === 'string') return flags.includes('+') || /[awx]/.test(flags);
  const writeFlags =
    fsConstants.O_WRONLY | fsConstants.O_RDWR | fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_TRUNC;
  return (flags & writeFlags) !== 0;
};

const createObservedFileSystem = (v1IndexFile: string): ObservedFileSystem => {
  const protectedIndexes = new Set([path.resolve(v1IndexFile), realpathSync(v1IndexFile)]);
  const mutations: FsMutation[] = [];
  const directMutators = new Set([
    'appendFile',
    'chmod',
    'chown',
    'copyFile',
    'cp',
    'link',
    'mkdir',
    'mkdtemp',
    'rename',
    'rm',
    'rmdir',
    'symlink',
    'truncate',
    'unlink',
    'utimes',
    'writeFile',
  ]);
  const methodsWithTwoPaths = new Set(['copyFile', 'cp', 'link', 'rename', 'symlink']);
  const methodsWithPathAccess = new Set([
    ...directMutators,
    'access',
    'lstat',
    'open',
    'opendir',
    'readFile',
    'readlink',
    'readdir',
    'realpath',
    'stat',
    'statfs',
  ]);
  const writeHandleMethods = new Set(['appendFile', 'truncate', 'write', 'writeFile', 'writev']);

  const pathArguments = (method: string, args: unknown[]): string[] => {
    const count = methodsWithTwoPaths.has(method) ? 2 : 1;
    return args.slice(0, count).flatMap((argument) => {
      const resolved = asPath(argument);
      return resolved === null ? [] : [resolved];
    });
  };
  const poisonV1Index = (paths: string[]): void => {
    if (paths.some((candidate) => protectedIndexes.has(candidate))) {
      throw new Error('Schema-2 storage accessed the schema-1 projects.json index');
    }
  };

  const fs = new Proxy(nodeFs, {
    get(target, property, receiver) {
      if (property === 'open') {
        return async (...args: Parameters<typeof nodeFs.open>) => {
          const file = asPath(args[0]);
          const paths = file === null ? [] : [file];
          poisonV1Index(paths);
          if (isWriteCapableOpen(args[1])) mutations.push({ method: 'open', paths });
          const handle = await nodeFs.open(...args);
          return new Proxy(handle, {
            get(handleTarget, handleProperty, handleReceiver) {
              const value = Reflect.get(handleTarget, handleProperty, handleReceiver) as unknown;
              if (typeof value !== 'function') return value;
              if (typeof handleProperty === 'string' && writeHandleMethods.has(handleProperty)) {
                return (...handleArgs: unknown[]) => {
                  mutations.push({ method: `handle.${handleProperty}`, paths });
                  return Reflect.apply(value, handleTarget, handleArgs);
                };
              }
              return value.bind(handleTarget);
            },
          });
        };
      }
      if (typeof property !== 'string' || !methodsWithPathAccess.has(property)) {
        return Reflect.get(target, property, receiver);
      }
      const method = Reflect.get(target, property, receiver) as unknown;
      if (typeof method !== 'function') return method;
      return (...args: unknown[]) => {
        const paths = pathArguments(property, args);
        poisonV1Index(paths);
        if (directMutators.has(property)) mutations.push({ method: property, paths });
        return Reflect.apply(method, target, args);
      };
    },
  }) as typeof nodeFs;

  return {
    fs,
    mutations,
    clearMutations: () => {
      mutations.length = 0;
    },
  };
};

const makeV2Input = (): CreateStudioProjectInputV2 => ({
  name: 'Schema 2 project',
  brief: 'A clean Section and Clip project',
  aspectRatio: '16:9',
  targetDurationSeconds: 10,
  resolution: '1080p',
});

const expectV1Snapshot = async (rootDir: string, expected: SnapshotEntry[]): Promise<void> => {
  expect(await snapshotV1Profile(rootDir)).toEqual(expected);
};

describe('Creative Studio schema-2 storage cutover', () => {
  it('removes the schema-1 Studio public type and managed-asset helper surface', async () => {
    const [typesSource, managedAssetSource] = await Promise.all([
      readFile(path.resolve(process.cwd(), 'packages/desktop/src/common/types/project/creativeStudioTypes.ts'), 'utf8'),
      readFile(
        path.resolve(
          process.cwd(),
          'packages/desktop/src/common/types/project/creativeStudioManagedAssetCollections.ts'
        ),
        'utf8'
      ),
    ]);
    const removedTypeExports = [
      'STUDIO_REFERENCE_PROMPT_MAX_LENGTH',
      'STUDIO_MAX_SCENES',
      'STUDIO_MAX_GENERATION_SCENES_PER_REQUEST',
      'STUDIO_MAX_REFERENCE_REQUEST_SCENES',
      'STUDIO_MAX_CUT_PLACEMENT_SCENES',
      'STUDIO_MAX_CUT_PLACEMENT_CLIPS',
      'STUDIO_MAX_DIRTY_SCENES_REPORTED',
      'STUDIO_MAX_MCP_AVAILABLE_TAKE_IDS_PER_SCENE',
      'STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION',
      'isStudioSceneCountTransitionAllowed',
      'StudioTextModelRef',
      'StudioTextModelOption',
      'StudioManagedAssetRef',
      'StudioAsset',
      'StudioOutputRole',
      'StudioReferenceInputSnapshot',
      'StudioJob',
      'StudioRendererJob',
      'StudioSceneReviewState',
      'StudioScene',
      'StudioEditableScene',
      'StudioDirectorNewSceneV1',
      'StudioDirectorOperationV1',
      'StudioDirectorCommandRecordV1',
      'StudioDirectorCommandSlotV1',
      'StudioDirectorCommandSlotLeaseV1',
      'StudioDirectorCommandRejectionCode',
      'StudioDirectorAppliedReceiptV1',
      'StudioDirectorRejectedReceiptV1',
      'StudioDirectorExpiredReceiptV1',
      'StudioDirectorIndeterminateReceiptV1',
      'StudioDirectorCommandReceiptV1',
      'StudioNormalisedRect',
      'StudioCutFilter',
      'StudioCutClip',
      'StudioCut',
      'StudioEditableCutClip',
      'StudioEditableCut',
      'StudioRoutingPreferences',
      'StudioRuleListUndo',
      'StudioRendererRoutingPreferences',
      'StudioReplaceStoryboardProposalPayload',
      'StudioPinRuleProposalPayload',
      'StudioProposalPayload',
      'StudioEditableSceneField',
      'StudioProposalSceneChange',
      'StudioProposalDiff',
      'StudioProposal',
      'StudioRecordProposalInput',
      'StudioProposalRequest',
      'StudioProposalAcceptance',
      'StudioReferenceRequest',
      'StudioReferenceRequestAuthority',
      'StudioDismissReferenceRequestsRequest',
      'StudioRouteCatalog',
      'StudioProjectRequest',
      'StudioRenderErrorCode',
      'StudioRenderCutResult',
      'StudioCancelRenderResult',
      'StudioRenderProgressEvent',
      'StudioLatestRender',
      'ProposeStudioStoryboardInput',
      'StudioDeleteProjectRequest',
      'StudioUpdateProjectRequest',
      'StudioBindBriefConversationRequest',
      'StudioSetBriefRulesRequest',
      'StudioUpdateCutRequest',
      'StudioPlaceCutScenesRequest',
      'StudioModelSelectionChange',
      'StudioUpdateModelSelectionRequest',
      'StudioUpdateSceneRequest',
      'StudioReorderScenesRequest',
      'StudioAssetRequest',
      'StudioPersistCapturedPosterRequest',
      'StudioSelectVariationRequest',
      'StudioSelectAssetRequest',
      'StudioSceneGenerationChoice',
      'StudioGenerationSubmitMode',
      'StudioSceneReferencePrompt',
      'StudioSubmitScenesRequest',
      'StudioFitStoryboardRequest',
      'StudioFitStoryboardOutcome',
      'StudioChooseAndImportReferenceRequest',
      'StudioChooseAndExportAssetsRequest',
      'StudioListRoutesRequest',
      'StudioImportOutcome',
      'StudioExportItem',
      'StudioExportOutcome',
      'StudioDesktopApi',
    ] as const;
    for (const exportName of removedTypeExports) {
      expect(typesSource, exportName).not.toMatch(new RegExp(`export (?:type|const|function) ${exportName}\\b`));
    }
    for (const exportName of [
      'STUDIO_MANAGED_ASSET_COLLECTIONS',
      'resolveActiveStudioBriefReferences',
      'StudioReferencePlateFreshness',
      'getStudioReferencePlateFreshness',
    ]) {
      expect(managedAssetSource, exportName).not.toMatch(new RegExp(`export (?:type|const|function) ${exportName}\\b`));
    }
    expect(typesSource).toMatch(/export type StudioAssetV2\s*=\s*\{/);
    expect(typesSource).toMatch(/export type StudioJobV2\s*=\s*\{/);
    expect(typesSource).toMatch(/export type StudioProjectV2\s*=\s*\{/);
  });

  it('classifies a complete V1-only profile without reading its index or mutating any path', async () => {
    const fixture = await createCompleteV1Profile();
    const before = await snapshotV1Profile(fixture.rootDir);
    expect(before.map((entry) => entry.relativePath)).toEqual(EXPECTED_V1_PATHS);
    const observed = createObservedFileSystem(fixture.indexFile);
    const watchProposalTree = vi.fn(() => ({ close: vi.fn() }));
    const store = createCreativeStudioStore({
      rootDir: fixture.rootDir,
      fs: observed.fs,
      createId: () => V2_PROJECT_ID,
      watchProposalTree,
    });

    await expect(store.getProjectV2(V1_PROJECT_ID)).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      projectId: V1_PROJECT_ID,
    });
    await expect(store.listProjectsV2()).resolves.toEqual({
      projects: [],
      unsupportedProjectIds: [V1_PROJECT_ID],
      quarantinedProjectIds: [],
    });
    await expect(store.inspectProjectsV2()).resolves.toEqual({
      supportedProjectIds: [],
      unsupportedProjectIds: [V1_PROJECT_ID],
      quarantinedProjectIds: [],
    });

    expect(observed.mutations).toEqual([]);
    expect(watchProposalTree).not.toHaveBeenCalled();
    await expectV1Snapshot(fixture.rootDir, before);
    await expect(nodeFs.access(path.join(fixture.rootDir, 'projects-v2.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each([2, 3, 4] as const)(
    'keeps a schema-%d prototype manifest unsupported and byte-identical without compatibility artifacts',
    async (schemaVersion) => {
      const rootDir = await mkdtemp(path.join(tmpdir(), `studio-schema-${schemaVersion}-cutover-`));
      roots.push(rootDir);
      const projectId = `project_schema_${schemaVersion}`;
      const projectDir = path.join(rootDir, projectId);
      const projectFile = path.join(projectDir, 'project.json');
      const projectBytes = jsonBytes({
        schemaVersion,
        id: projectId,
        marker: `schema-${schemaVersion}-bytes-must-not-change`,
      });
      await mkdir(projectDir);
      await writeFile(projectFile, projectBytes);
      const before = await nodeFs.lstat(projectFile, { bigint: true });
      const store = createCreativeStudioStore({ rootDir });

      await expect(store.getProjectV2(projectId)).resolves.toEqual({
        status: 'unsupported_prototype_schema',
        projectId,
      });
      await expect(store.listProjectsV2()).resolves.toEqual({
        projects: [],
        unsupportedProjectIds: [projectId],
        quarantinedProjectIds: [],
      });
      await expect(store.inspectProjectsV2()).resolves.toEqual({
        supportedProjectIds: [],
        unsupportedProjectIds: [projectId],
        quarantinedProjectIds: [],
      });

      const after = await nodeFs.lstat(projectFile, { bigint: true });
      expect(await readFile(projectFile, 'utf8')).toBe(projectBytes);
      expect({
        dev: after.dev,
        ino: after.ino,
        size: after.size,
        mtimeNs: after.mtimeNs,
        ctimeNs: after.ctimeNs,
      }).toEqual({
        dev: before.dev,
        ino: before.ino,
        size: before.size,
        mtimeNs: before.mtimeNs,
        ctimeNs: before.ctimeNs,
      });
      await expect(readdir(projectDir)).resolves.toEqual(['project.json']);
      await expect(readdir(rootDir)).resolves.toEqual([projectId]);
    }
  );

  it('rejects Director binding and authority reads for schema-1 without changing any byte or inode', async () => {
    const fixture = await createCompleteV1Profile();
    const before = await snapshotV1Profile(fixture.rootDir);
    const observed = createObservedFileSystem(fixture.indexFile);
    const watchProposalTree = vi.fn(() => ({ close: vi.fn() }));
    const store = createCreativeStudioStore({
      rootDir: fixture.rootDir,
      fs: observed.fs,
      watchProposalTree,
    });
    const onProjectUpdated = vi.fn();
    const providerResolver = {
      listConnectionCandidates: vi.fn(),
      listGenerationRoutes: vi.fn(),
    };
    const jobManager = {
      dispatchAuthorizedJobsV2: vi.fn(),
      cancelJobV2: vi.fn(),
      retryJobV2: vi.fn(),
      retryDownloadV2: vi.fn(),
    };
    const getStudioServerScriptPath = vi.fn(() => '/bundled/builtin-mcp-studio.js');
    const service = createCreativeStudioServiceV2({
      store,
      providerResolver: providerResolver as never,
      jobManager: jobManager as never,
      getStudioServerScriptPath,
      onProjectUpdated,
    });

    await expect(
      service.bindDirectorConversation({
        projectId: V1_PROJECT_ID,
        expectedRevision: v1Project().revision,
        conversationId: 'conversation_v2',
      })
    ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
    await expect(service.getDirectorSessionAuthority({ projectId: V1_PROJECT_ID })).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });

    expect(observed.mutations).toEqual([]);
    expect(watchProposalTree).not.toHaveBeenCalled();
    expect(onProjectUpdated).not.toHaveBeenCalled();
    expect(providerResolver.listConnectionCandidates).not.toHaveBeenCalled();
    expect(providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(getStudioServerScriptPath).not.toHaveBeenCalled();
    expect(Object.values(jobManager).every((operation) => operation.mock.calls.length === 0)).toBe(true);
    await expectV1Snapshot(fixture.rootDir, before);
  });

  it('runs the V2 create, list, batch, restart, and delete lifecycle beside V1 without touching V1', async () => {
    const fixture = await createCompleteV1Profile();
    const before = await snapshotV1Profile(fixture.rootDir);
    const observed = createObservedFileSystem(fixture.indexFile);
    const watchProposalTree = vi.fn(() => ({ close: vi.fn() }));
    const commitFacts: StudioProjectCommitFacts[] = [];
    let clock = Date.parse('2026-08-17T07:00:00.000Z');
    const dependencies = {
      rootDir: fixture.rootDir,
      fs: observed.fs,
      now: () => new Date((clock += 1_000)).toISOString(),
      createId: () => V2_PROJECT_ID,
      watchProposalTree,
      onProjectCommitted: (facts: StudioProjectCommitFacts) => commitFacts.push(facts),
    };
    const store = createCreativeStudioStore(dependencies);

    const created = await store.createProjectV2(makeV2Input());
    expect(created).toMatchObject({ schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION, id: V2_PROJECT_ID, revision: 1 });

    observed.clearMutations();
    await expect(store.getProjectV2(V2_PROJECT_ID)).resolves.toMatchObject({
      status: 'supported',
      project: { id: V2_PROJECT_ID, revision: 1 },
    });
    await expect(store.listProjectsV2()).resolves.toMatchObject({
      projects: [{ id: V2_PROJECT_ID, beatCount: 0, shotCount: 0, pictureCount: 0 }],
      unsupportedProjectIds: [V1_PROJECT_ID],
      quarantinedProjectIds: [],
    });
    await expect(store.inspectProjectsV2()).resolves.toEqual({
      supportedProjectIds: [V2_PROJECT_ID],
      unsupportedProjectIds: [V1_PROJECT_ID],
      quarantinedProjectIds: [],
    });
    expect(observed.mutations).toEqual([]);

    const restartedStore = createCreativeStudioStore(dependencies);
    await expect(restartedStore.getProjectV2(V2_PROJECT_ID)).resolves.toMatchObject({
      status: 'supported',
      project: { id: V2_PROJECT_ID, revision: 1 },
    });
    await expect(restartedStore.listProjectsV2()).resolves.toMatchObject({
      projects: [{ id: V2_PROJECT_ID }],
      unsupportedProjectIds: [V1_PROJECT_ID],
      quarantinedProjectIds: [],
    });
    await expect(restartedStore.inspectProjectsV2()).resolves.toMatchObject({
      supportedProjectIds: [V2_PROJECT_ID],
      unsupportedProjectIds: [V1_PROJECT_ID],
      quarantinedProjectIds: [],
    });
    expect(observed.mutations).toEqual([]);

    await expect(restartedStore.deleteProjectV2(V1_PROJECT_ID, 4)).rejects.toMatchObject({
      code: 'unsupported_prototype_schema',
    });
    expect(observed.mutations).toEqual([]);

    const applied = await restartedStore.applyMutationBatchV2(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: V2_PROJECT_ID,
        expectedRevision: 1,
        operations: [{ kind: 'set_brief', brief: 'Committed after restart' }],
      },
      { mutationId: 'mutation_schema2_cutover', capturedAt: FIXTURE_TIME },
      'schema2-cutover-proof'
    );
    expect(applied).toMatchObject({
      project: { id: V2_PROJECT_ID, revision: 2, brief: 'Committed after restart' },
      createdBeatIds: [],
      createdShotIds: [],
    });
    expect(commitFacts).toEqual([
      {
        projectId: V2_PROJECT_ID,
        previousRevision: 1,
        committedRevision: 2,
        committedAt: applied.project.updatedAt,
        commitTag: 'schema2-cutover-proof',
      },
    ]);

    await expect(restartedStore.deleteProjectV2(V2_PROJECT_ID, 2)).resolves.toBe(true);
    await expect(restartedStore.getProjectV2(V2_PROJECT_ID)).resolves.toEqual({
      status: 'not_found',
      projectId: V2_PROJECT_ID,
    });
    await expect(restartedStore.inspectProjectsV2()).resolves.toEqual({
      supportedProjectIds: [],
      unsupportedProjectIds: [V1_PROJECT_ID],
      quarantinedProjectIds: [],
    });

    const v2Index = JSON.parse(await readFile(path.join(fixture.rootDir, 'projects-v2.json'), 'utf8')) as unknown;
    expect(v2Index).toEqual({ schemaVersion: 2, projects: [] });
    expect(watchProposalTree).not.toHaveBeenCalled();
    await expectV1Snapshot(fixture.rootDir, before);

    const v1Owned = (candidate: string): boolean =>
      candidate === fixture.indexFile ||
      candidate === fixture.projectDir ||
      candidate.startsWith(`${fixture.projectDir}${path.sep}`);
    expect(observed.mutations.filter((mutation) => mutation.paths.some(v1Owned))).toEqual([]);
  });
});
