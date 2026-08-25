/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

/* eslint-disable no-await-in-loop -- Retention publications intentionally depend on prior catalog revisions. */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, promises as fs, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  StudioExportArtifactV2,
  StudioExportCatalogV2,
  StudioExportShapeV2,
} from '@/common/types/project/creativeStudioTypes';
import { createEmptyStudioProjectV2 } from '@/process/services/creative-studio/service/schema2/factories';
import {
  StudioExportCatalogErrorV2,
  compareStudioExportRelativePathsV2,
  createLogicalStudioExportCatalogV2,
  createStudioExportCatalogStoreV2,
  isSafeStudioExportRelativePathV2,
  parseStudioExportCatalogV2,
  parseStudioExportManifestV2,
  projectStudioRendererExportCatalogV2,
  publishStudioExportArtifactInCatalogV2,
  serializeStudioExportCatalogV2,
  serializeStudioExportManifestV2,
  validateStudioExportCatalogIdentityProofsV2,
  validateStudioExportCatalogV2,
  type StudioExportCreatePlanV2,
  type StudioExportManifestEntryV2,
  type StudioExportProjectAuthorityV2,
} from '@/process/services/creative-studio/service/schema2/exports';

const CONTEXT = { projectId: 'project_1', currentProjectRevision: 7 } as const;
const CREATED_AT = '2026-08-20T00:00:00.000Z';
const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

const manifestFor = (...entries: StudioExportManifestEntryV2[]) => {
  const bytes = serializeStudioExportManifestV2(entries);
  return parseStudioExportManifestV2(bytes);
};

const makeArtifact = (
  id: string,
  shape: StudioExportArtifactV2['shape'] = 'editor_folder',
  createdAt = CREATED_AT,
  manifest = manifestFor({ relativePath: 'timeline.json', byteSize: 4, sha256: 'a'.repeat(64) })
): StudioExportArtifactV2 => ({
  schemaVersion: 5,
  id,
  projectId: CONTEXT.projectId,
  sourceRevision: CONTEXT.currentProjectRevision,
  shape,
  payloadKind: shape === 'editor_folder' ? 'directory' : 'file',
  managedExport: { collection: 'exports', fileName: `managed_${id}` },
  byteSize: manifest.byteSize,
  fileCount: manifest.fileCount,
  manifestSha256: manifest.manifestSha256,
  createdAt,
});

const expectCode = (operation: () => unknown, code: string): void => {
  expect(operation).toThrow(expect.objectContaining({ code }));
};

const expectAsyncCode = async (operation: Promise<unknown>, code: string): Promise<void> => {
  await expect(operation).rejects.toMatchObject({ code });
};

const makeAuthority = async (): Promise<StudioExportProjectAuthorityV2> => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-export-catalog-'));
  const canonicalRoot = await fs.realpath(temporary);
  createdDirectories.push(canonicalRoot);
  const projectDir = path.join(canonicalRoot, 'project_1');
  await fs.mkdir(projectDir);
  return {
    projectDir,
    project: createEmptyStudioProjectV2(
      {
        name: 'Catalog project',
        brief: '',
        aspectRatio: '16:9',
        targetDurationSeconds: 30,
        resolution: '1080p',
      },
      'project_1',
      CREATED_AT
    ),
  };
};

const nonceSequence = (): (() => string) => {
  let index = 0;
  return () => `nonce_${++index}`;
};

const fileNameForShape = (shape: StudioExportShapeV2): string => {
  if (shape === 'still') return 'still.png';
  if (shape === 'script') return 'script.md';
  return 'timeline.json';
};

const makeCreatePlan = (
  id: string,
  expectedCatalogRevision: number,
  shape: StudioExportShapeV2 = 'script',
  bytes: Uint8Array = Buffer.from(`# ${id}\n`),
  createdAt = CREATED_AT
): StudioExportCreatePlanV2 => ({
  expectedProjectRevision: 1,
  expectedCatalogRevision,
  artifactId: `artifact_${id}`,
  managedFileName: `managed_${id}`,
  shape,
  createdAt,
  files: [{ kind: 'generated', relativePath: fileNameForShape(shape), bytes }],
});

describe('schema-2 export catalog', () => {
  it('treats absence as logical revision one and projects only renderer-safe fields', () => {
    const logical = parseStudioExportCatalogV2(null, CONTEXT);
    expect(logical).toEqual({ schemaVersion: 5, projectId: 'project_1', revision: 1, artifacts: [] });
    expect(createLogicalStudioExportCatalogV2('project_1')).toEqual(logical);

    const artifact = makeArtifact('artifact_1');
    const catalog = { ...logical, revision: 2, artifacts: [artifact] };
    expect(projectStudioRendererExportCatalogV2(catalog)).toEqual({
      revision: 2,
      artifacts: [
        {
          id: 'artifact_1',
          sourceRevision: 7,
          shape: 'editor_folder',
          folderName: 'managed_artifact_1',
          byteSize: 4,
          fileCount: 1,
          createdAt: CREATED_AT,
        },
      ],
    });
    expect(JSON.stringify(projectStudioRendererExportCatalogV2(catalog))).not.toMatch(
      /projectId|managedExport|manifestSha256|payloadKind/
    );
  });

  it('round-trips only canonical exact-key catalog bytes and refuses raw authority mismatches', () => {
    const catalog: StudioExportCatalogV2 = {
      schemaVersion: 5,
      projectId: CONTEXT.projectId,
      revision: 2,
      artifacts: [makeArtifact('artifact_1')],
    };
    const bytes = serializeStudioExportCatalogV2(catalog, CONTEXT);
    expect(parseStudioExportCatalogV2(bytes, CONTEXT)).toEqual(catalog);

    expectCode(() => parseStudioExportCatalogV2(Buffer.concat([bytes, Buffer.from('\n')]), CONTEXT), 'invalid_catalog');
    expectCode(
      () => parseStudioExportCatalogV2(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]), CONTEXT),
      'invalid_catalog'
    );
    const cases: unknown[] = [
      { ...catalog, extra: true },
      { ...catalog, projectId: 'project_2' },
      { ...catalog, revision: 0 },
      { ...catalog, artifacts: [{ ...catalog.artifacts[0], sourceRevision: 8 }] },
      {
        ...catalog,
        artifacts: [{ ...catalog.artifacts[0], payloadKind: 'file' }],
      },
      {
        ...catalog,
        artifacts: [catalog.artifacts[0], { ...catalog.artifacts[0], id: 'artifact_2' }],
      },
      {
        ...catalog,
        artifacts: [
          catalog.artifacts[0],
          { ...catalog.artifacts[0], managedExport: { collection: 'exports', fileName: 'x' } },
        ],
      },
    ];
    for (const value of cases) expect(validateStudioExportCatalogV2(value, CONTEXT)).toBe(false);
  });

  it('rejects every non-data catalog shape and every malformed artifact authority field', () => {
    const artifact = makeArtifact('artifact_1');
    const catalog: StudioExportCatalogV2 = {
      schemaVersion: 5,
      projectId: CONTEXT.projectId,
      revision: 2,
      artifacts: [artifact],
    };
    const withArtifact = (changes: Readonly<Record<string, unknown>>): unknown => ({
      ...catalog,
      artifacts: [{ ...artifact, ...changes }],
    });

    const inheritedCatalog = Object.assign(Object.create({ inherited: true }) as object, catalog);
    const symbolCatalog = { ...catalog } as Record<PropertyKey, unknown>;
    symbolCatalog[Symbol('authority')] = true;
    const accessorCatalog = { ...catalog } as Record<string, unknown>;
    Object.defineProperty(accessorCatalog, 'revision', { enumerable: true, get: () => 2 });
    const hiddenCatalog = { ...catalog } as Record<string, unknown>;
    Object.defineProperty(hiddenCatalog, 'hidden', { enumerable: false, value: true });

    const customArtifacts = [artifact];
    Object.setPrototypeOf(customArtifacts, null);
    const sparseArtifacts: StudioExportArtifactV2[] = [];
    sparseArtifacts.length = 1;
    const accessorArtifacts = [artifact];
    Object.defineProperty(accessorArtifacts, '0', { enumerable: true, get: () => artifact });
    const hiddenArtifacts = [artifact];
    Object.defineProperty(hiddenArtifacts, '0', { enumerable: false, value: artifact });
    const extraKeyArtifacts = [artifact] as StudioExportArtifactV2[] & { authority?: boolean };
    extraKeyArtifacts.authority = true;

    const missingArtifactKey = { ...artifact } as Partial<StudioExportArtifactV2>;
    delete missingArtifactKey.createdAt;
    const malformedCatalogs: unknown[] = [
      null,
      7,
      [],
      inheritedCatalog,
      symbolCatalog,
      accessorCatalog,
      hiddenCatalog,
      { ...catalog, schemaVersion: 1 },
      { ...catalog, revision: Number.NaN },
      { ...catalog, artifacts: customArtifacts },
      { ...catalog, artifacts: sparseArtifacts },
      { ...catalog, artifacts: accessorArtifacts },
      { ...catalog, artifacts: hiddenArtifacts },
      { ...catalog, artifacts: extraKeyArtifacts },
      { ...catalog, artifacts: Array.from({ length: 16 }, (_, index) => makeArtifact(`artifact_${index}`)) },
      { ...catalog, artifacts: [null] },
      { ...catalog, artifacts: [missingArtifactKey] },
      withArtifact({ schemaVersion: 1 }),
      withArtifact({ id: 1 }),
      withArtifact({ id: 'invalid id' }),
      withArtifact({ projectId: 'project_2' }),
      withArtifact({ sourceRevision: 0 }),
      withArtifact({ sourceRevision: 8 }),
      withArtifact({ shape: 'archive' }),
      withArtifact({ managedExport: null }),
      withArtifact({ managedExport: { collection: 'exports', fileName: 'managed', extra: true } }),
      withArtifact({ managedExport: { collection: 'imports', fileName: 'managed' } }),
      withArtifact({ managedExport: { collection: 'exports', fileName: 1 } }),
      withArtifact({ managedExport: { collection: 'exports', fileName: 'invalid name' } }),
      withArtifact({ byteSize: -1 }),
      withArtifact({ byteSize: 1.5 }),
      withArtifact({ fileCount: 0 }),
      withArtifact({ fileCount: 1.5 }),
      withArtifact({ manifestSha256: 1 }),
      withArtifact({ manifestSha256: 'A'.repeat(64) }),
      withArtifact({ createdAt: 1 }),
      withArtifact({ createdAt: 'short' }),
      withArtifact({ createdAt: '2026-99-99T00:00:00.000Z' }),
      withArtifact({ createdAt: '2026-08-20T00:00:00.000z' }),
      withArtifact({ payloadKind: 'file' }),
      withArtifact({ fileCount: 105 }),
      withArtifact({ shape: 'still', payloadKind: 'directory' }),
      withArtifact({ shape: 'script', payloadKind: 'file', fileCount: 2 }),
    ];
    for (const value of malformedCatalogs) expect(validateStudioExportCatalogV2(value, CONTEXT)).toBe(false);

    const nullPrototypeManagedExport = Object.assign(Object.create(null) as object, artifact.managedExport);
    const nullPrototypeArtifact = Object.assign(Object.create(null) as object, {
      ...artifact,
      managedExport: nullPrototypeManagedExport,
    });
    const nullPrototypeCatalog = Object.assign(Object.create(null) as object, {
      ...catalog,
      artifacts: [nullPrototypeArtifact],
    });
    expect(validateStudioExportCatalogV2(nullPrototypeCatalog, CONTEXT)).toBe(true);

    expect(
      validateStudioExportCatalogV2(catalog, {
        projectId: 'invalid project',
        currentProjectRevision: CONTEXT.currentProjectRevision,
      })
    ).toBe(false);
    expect(validateStudioExportCatalogV2(catalog, { projectId: CONTEXT.projectId, currentProjectRevision: 0 })).toBe(
      false
    );
    expectCode(() => createLogicalStudioExportCatalogV2('invalid project'), 'invalid_catalog');
    expectCode(() => serializeStudioExportCatalogV2({ ...catalog, revision: 0 }, CONTEXT), 'invalid_catalog');
    expectCode(
      () =>
        publishStudioExportArtifactInCatalogV2(
          { ...catalog, revision: 0 },
          {
            ...CONTEXT,
            expectedCatalogRevision: 0,
            artifact: makeArtifact('artifact_2'),
          }
        ),
      'invalid_catalog'
    );
  });

  it('rejects malformed UTF-8, paths, manifests, retention overflow, and incomplete identity proofs', () => {
    expectCode(() => parseStudioExportCatalogV2(Uint8Array.of(0xff), CONTEXT), 'invalid_catalog');
    expectCode(() => parseStudioExportCatalogV2(Buffer.from('{'), CONTEXT), 'invalid_catalog');
    expectCode(() => parseStudioExportManifestV2(Uint8Array.of(0xff)), 'invalid_manifest');
    expectCode(() => parseStudioExportManifestV2(Buffer.from('{')), 'invalid_manifest');

    expect(compareStudioExportRelativePathsV2('a', 'b')).toBeLessThan(0);
    expect(compareStudioExportRelativePathsV2('b', 'a')).toBeGreaterThan(0);
    expect(compareStudioExportRelativePathsV2('same', 'same')).toBe(0);
    expect(isSafeStudioExportRelativePathV2('media/shot-001.mp4')).toBe(true);
    for (const value of [null, '', 'media\\shot.mp4', 'media/shot\u0000.mp4', 'a/b/c/d/e', '.', '..', 'bad path']) {
      expect(isSafeStudioExportRelativePathV2(value)).toBe(false);
    }

    const malformedEntries: unknown[] = [
      [null],
      [],
      [{ relativePath: 'timeline.json', byteSize: -1, sha256: 'a'.repeat(64) }],
      [{ relativePath: 'timeline.json', byteSize: 1.5, sha256: 'a'.repeat(64) }],
      [{ relativePath: 'timeline.json', byteSize: 1, sha256: 1 }],
      [{ relativePath: 'timeline.json', byteSize: 1, sha256: 'A'.repeat(64) }],
    ];
    for (const entries of malformedEntries) {
      expectCode(
        () => serializeStudioExportManifestV2(entries as readonly StudioExportManifestEntryV2[]),
        'invalid_manifest'
      );
    }
    expectCode(
      () =>
        parseStudioExportManifestV2(
          Buffer.from(
            JSON.stringify([{ relativePath: 'timeline.json', byteSize: 1, sha256: 'a'.repeat(64), extra: true }])
          )
        ),
      'invalid_manifest'
    );

    const sixScripts = Array.from({ length: 6 }, (_, index) =>
      makeArtifact(`artifact_${index}`, 'script', `2026-08-20T00:00:0${index}.000Z`)
    );
    const overRetained: StudioExportCatalogV2 = {
      schemaVersion: 5,
      projectId: CONTEXT.projectId,
      revision: 7,
      artifacts: sixScripts,
    };
    expect(validateStudioExportCatalogV2(overRetained, CONTEXT)).toBe(false);

    const manifestA = manifestFor({ relativePath: 'a', byteSize: 4, sha256: 'a'.repeat(64) });
    const manifestB = manifestFor({ relativePath: 'b', byteSize: 5, sha256: 'b'.repeat(64) });
    const artifacts = [
      makeArtifact('artifact_a', 'editor_folder', CREATED_AT, manifestA),
      makeArtifact('artifact_b', 'still', '2026-08-20T00:00:01.000Z', manifestB),
    ];
    const catalog: StudioExportCatalogV2 = {
      schemaVersion: 5,
      projectId: CONTEXT.projectId,
      revision: 2,
      artifacts,
    };
    const proofs = [
      {
        artifactId: 'artifact_a',
        directory: { dev: '1', ino: '10' },
        payloads: [{ relativePath: 'a', dev: '1', ino: '20', nlink: 1, byteSize: 4, sha256: 'a'.repeat(64) }],
      },
      {
        artifactId: 'artifact_b',
        directory: { dev: '1', ino: '11' },
        payloads: [{ relativePath: 'b', dev: '1', ino: '21', nlink: 1, byteSize: 5, sha256: 'b'.repeat(64) }],
      },
    ];
    expect(validateStudioExportCatalogIdentityProofsV2(catalog, CONTEXT, proofs.slice(0, 1))).toBe(false);
    expect(
      validateStudioExportCatalogIdentityProofsV2(catalog, CONTEXT, [
        proofs[0]!,
        { ...proofs[1]!, artifactId: 'artifact_a' },
      ])
    ).toBe(false);
    expect(
      validateStudioExportCatalogIdentityProofsV2(catalog, CONTEXT, [
        proofs[0]!,
        { ...proofs[1]!, artifactId: 'artifact_missing' },
      ])
    ).toBe(false);
    expect(
      validateStudioExportCatalogIdentityProofsV2(catalog, CONTEXT, [
        { ...proofs[0]!, directory: { dev: '01', ino: '10' } },
        proofs[1]!,
      ])
    ).toBe(false);
    expect(
      validateStudioExportCatalogIdentityProofsV2(catalog, CONTEXT, [
        { ...proofs[0]!, payloads: [{ ...proofs[0]!.payloads[0]!, ino: '01' }] },
        proofs[1]!,
      ])
    ).toBe(false);
    expect(
      validateStudioExportCatalogIdentityProofsV2(catalog, CONTEXT, [
        { ...proofs[0]!, payloads: [{ ...proofs[0]!.payloads[0]!, byteSize: 3 }] },
        proofs[1]!,
      ])
    ).toBe(false);
  });

  it('parses only exact canonical sorted manifests with safe bounded relative paths and sums bytes safely', () => {
    const entries: StudioExportManifestEntryV2[] = [
      { relativePath: 'media/shot-001.mp4', byteSize: 11, sha256: 'a'.repeat(64) },
      { relativePath: 'timeline.json', byteSize: 7, sha256: 'b'.repeat(64) },
    ];
    const bytes = serializeStudioExportManifestV2(entries);
    expect(parseStudioExportManifestV2(bytes)).toMatchObject({
      entries,
      byteSize: 18,
      fileCount: 2,
      manifestSha256: createHash('sha256').update(bytes).digest('hex'),
    });

    const invalidManifests: unknown[] = [
      [{ relativePath: '../outside', byteSize: 1, sha256: 'a'.repeat(64) }],
      [{ relativePath: '/absolute', byteSize: 1, sha256: 'a'.repeat(64) }],
      [{ relativePath: 'media\\file', byteSize: 1, sha256: 'a'.repeat(64) }],
      [{ relativePath: 'a/b/c/d/e', byteSize: 1, sha256: 'a'.repeat(64) }],
      [
        { relativePath: 'same', byteSize: 1, sha256: 'a'.repeat(64) },
        { relativePath: 'same', byteSize: 1, sha256: 'b'.repeat(64) },
      ],
      [
        { relativePath: 'z', byteSize: 1, sha256: 'a'.repeat(64) },
        { relativePath: 'a', byteSize: 1, sha256: 'b'.repeat(64) },
      ],
      [{ sha256: 'a'.repeat(64), byteSize: 1, relativePath: 'wrong-key-order' }],
      [
        { relativePath: 'overflow-a', byteSize: Number.MAX_SAFE_INTEGER, sha256: 'a'.repeat(64) },
        { relativePath: 'overflow-b', byteSize: 1, sha256: 'b'.repeat(64) },
      ],
    ];
    for (const manifest of invalidManifests) {
      expectCode(() => parseStudioExportManifestV2(Buffer.from(JSON.stringify(manifest))), 'invalid_manifest');
    }
    expectCode(() => parseStudioExportManifestV2(Buffer.from(`${JSON.stringify(entries)}\n`)), 'invalid_manifest');
    expectCode(
      () => parseStudioExportManifestV2(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes])),
      'invalid_manifest'
    );
  });

  it('increments once, enforces exact catalog CAS, and evicts the oldest fifth artifact by time and ID', () => {
    const artifacts = ['a', 'b', 'c', 'd', 'e'].map((id) => makeArtifact(`artifact_${id}`));
    const catalog: StudioExportCatalogV2 = {
      schemaVersion: 5,
      projectId: CONTEXT.projectId,
      revision: 6,
      artifacts,
    };
    const result = publishStudioExportArtifactInCatalogV2(catalog, {
      ...CONTEXT,
      expectedCatalogRevision: 6,
      artifact: makeArtifact('artifact_z'),
    });
    expect(result.catalog.revision).toBe(7);
    expect(result.catalog.artifacts.map(({ id }) => id)).toEqual([
      'artifact_b',
      'artifact_c',
      'artifact_d',
      'artifact_e',
      'artifact_z',
    ]);
    expect(result.evictedArtifacts.map(({ id }) => id)).toEqual(['artifact_a']);
    expect(catalog.revision).toBe(6);
    expect(catalog.artifacts.map(({ id }) => id)).toEqual(artifacts.map(({ id }) => id));

    expectCode(
      () =>
        publishStudioExportArtifactInCatalogV2(catalog, {
          ...CONTEXT,
          expectedCatalogRevision: 5,
          artifact: makeArtifact('artifact_z'),
        }),
      'stale_catalog_revision'
    );
    expectCode(
      () =>
        publishStudioExportArtifactInCatalogV2(catalog, {
          ...CONTEXT,
          expectedCatalogRevision: 6,
          artifact: { ...makeArtifact('artifact_z'), sourceRevision: 6 },
        }),
      'invalid_artifact'
    );
  });

  it('refuses revision overflow and catalog-wide directory aliases, hard links, and manifest substitution', () => {
    const manifestA = manifestFor({ relativePath: 'a', byteSize: 4, sha256: 'a'.repeat(64) });
    const manifestB = manifestFor({ relativePath: 'b', byteSize: 5, sha256: 'b'.repeat(64) });
    const artifacts = [
      makeArtifact('artifact_a', 'editor_folder', CREATED_AT, manifestA),
      makeArtifact('artifact_b', 'still', '2026-08-20T00:00:01.000Z', manifestB),
    ];
    const catalog: StudioExportCatalogV2 = {
      schemaVersion: 5,
      projectId: CONTEXT.projectId,
      revision: 2,
      artifacts,
    };
    const proofs = [
      {
        artifactId: 'artifact_a',
        directory: { dev: '1', ino: '10' },
        payloads: [{ relativePath: 'a', dev: '1', ino: '20', nlink: 1, byteSize: 4, sha256: 'a'.repeat(64) }],
      },
      {
        artifactId: 'artifact_b',
        directory: { dev: '1', ino: '11' },
        payloads: [{ relativePath: 'b', dev: '1', ino: '21', nlink: 1, byteSize: 5, sha256: 'b'.repeat(64) }],
      },
    ];
    expect(validateStudioExportCatalogIdentityProofsV2(catalog, CONTEXT, proofs)).toBe(true);
    expect(
      validateStudioExportCatalogIdentityProofsV2(catalog, CONTEXT, [
        proofs[0]!,
        { ...proofs[1]!, directory: proofs[0]!.directory },
      ])
    ).toBe(false);
    expect(
      validateStudioExportCatalogIdentityProofsV2(catalog, CONTEXT, [
        proofs[0]!,
        { ...proofs[1]!, payloads: [{ ...proofs[1]!.payloads[0]!, ino: '20' }] },
      ])
    ).toBe(false);
    expect(
      validateStudioExportCatalogIdentityProofsV2(catalog, CONTEXT, [
        { ...proofs[0]!, payloads: [{ ...proofs[0]!.payloads[0]!, nlink: 2 }] },
        proofs[1]!,
      ])
    ).toBe(false);
    expect(
      validateStudioExportCatalogIdentityProofsV2(catalog, CONTEXT, [
        { ...proofs[0]!, payloads: [{ ...proofs[0]!.payloads[0]!, sha256: 'c'.repeat(64) }] },
        proofs[1]!,
      ])
    ).toBe(false);

    const overflow = { ...catalog, revision: Number.MAX_SAFE_INTEGER };
    expectCode(
      () =>
        publishStudioExportArtifactInCatalogV2(overflow, {
          ...CONTEXT,
          expectedCatalogRevision: Number.MAX_SAFE_INTEGER,
          artifact: makeArtifact('artifact_z'),
        }),
      'catalog_revision_overflow'
    );
    expect(new StudioExportCatalogErrorV2('invalid_catalog').code).toBe('invalid_catalog');
  });
});

describe('createStudioExportCatalogStoreV2 filesystem authority', () => {
  it('rejects malformed authorities, dependency bounds, plans, and verified streams before publication', async () => {
    expectCode(() => createStudioExportCatalogStoreV2({ maxArtifactBytes: 0 }), 'storage_error');
    expectCode(() => createStudioExportCatalogStoreV2({ maxProjectBytes: 0 }), 'storage_error');
    expect(createStudioExportCatalogStoreV2()).toBeDefined();

    const authority = await makeAuthority();
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const invalidAuthorities: StudioExportProjectAuthorityV2[] = [
      { ...authority, project: { ...authority.project, id: 'invalid project' } },
      { ...authority, project: { ...authority.project, revision: 0 } },
      { ...authority, projectDir: 'relative/project_1' },
      { ...authority, projectDir: `${authority.projectDir}${path.sep}..${path.sep}project_1` },
      { ...authority, projectDir: path.join(path.dirname(authority.projectDir), 'wrong_project') },
      { ...authority, assertCurrent: true as unknown as () => Promise<void> },
      { ...authority, assertActive: true as unknown as () => void },
    ];
    for (const invalidAuthority of invalidAuthorities) {
      await expectAsyncCode(store.list(invalidAuthority), 'storage_error');
    }

    const base = makeCreatePlan('validation', 1, 'still', Buffer.from('x'));
    const sparseFiles: StudioExportCreatePlanV2['files'][number][] = [];
    sparseFiles.length = 1;
    const generated = base.files[0]!;
    const verified = {
      kind: 'verified_stream' as const,
      relativePath: 'still.png',
      byteSize: 1,
      sha256: createHash('sha256').update('x').digest('hex'),
      openVerifiedStream: async () =>
        (async function* (): AsyncIterable<Uint8Array> {
          yield Buffer.from('x');
        })(),
    };
    const asPlan = (value: unknown): StudioExportCreatePlanV2 => value as StudioExportCreatePlanV2;
    const invalidPlans: Array<{ plan: StudioExportCreatePlanV2; code: string }> = [
      { plan: { ...base, expectedProjectRevision: 2 }, code: 'stale_project_revision' },
      { plan: { ...base, expectedCatalogRevision: 0 }, code: 'invalid_create_plan' },
      { plan: { ...base, artifactId: '' }, code: 'invalid_create_plan' },
      { plan: { ...base, managedFileName: '' }, code: 'invalid_create_plan' },
      { plan: asPlan({ ...base, shape: 'archive' }), code: 'invalid_create_plan' },
      { plan: { ...base, createdAt: 'not-a-time' }, code: 'invalid_create_plan' },
      { plan: { ...base, files: [] }, code: 'invalid_create_plan' },
      { plan: { ...base, files: sparseFiles }, code: 'invalid_create_plan' },
      {
        plan: {
          ...base,
          files: Array.from({ length: 105 }, (_, index) => ({
            kind: 'generated' as const,
            relativePath: `payload-${index}.bin`,
            bytes: Buffer.from('x'),
          })),
        },
        code: 'invalid_create_plan',
      },
      {
        plan: { ...base, files: [generated, { ...generated, relativePath: 'second.png' }] },
        code: 'invalid_create_plan',
      },
      { plan: asPlan({ ...base, files: [null] }), code: 'invalid_create_plan' },
      { plan: { ...base, files: [{ ...generated, relativePath: '../outside' }] }, code: 'invalid_create_plan' },
      { plan: { ...base, files: [{ ...generated, relativePath: 'artifact.json' }] }, code: 'invalid_create_plan' },
      { plan: { ...base, files: [{ ...generated, relativePath: 'manifest.json' }] }, code: 'invalid_create_plan' },
      {
        plan: {
          ...base,
          shape: 'editor_folder',
          files: [generated, { ...generated }],
        },
        code: 'invalid_create_plan',
      },
      { plan: asPlan({ ...base, files: [{ ...generated, extra: true }] }), code: 'invalid_create_plan' },
      { plan: asPlan({ ...base, files: [{ ...generated, bytes: 'x' }] }), code: 'invalid_create_plan' },
      { plan: asPlan({ ...base, files: [{ ...verified, extra: true }] }), code: 'invalid_create_plan' },
      { plan: asPlan({ ...base, files: [{ ...verified, byteSize: -1 }] }), code: 'invalid_create_plan' },
      { plan: asPlan({ ...base, files: [{ ...verified, sha256: 1 }] }), code: 'invalid_create_plan' },
      { plan: { ...base, files: [{ ...verified, sha256: 'A'.repeat(64) }] }, code: 'invalid_create_plan' },
      { plan: asPlan({ ...base, files: [{ ...verified, openVerifiedStream: true }] }), code: 'invalid_create_plan' },
      { plan: asPlan({ ...base, files: [{ ...generated, kind: 'foreign' }] }), code: 'invalid_create_plan' },
    ];
    for (const { plan, code } of invalidPlans) await expectAsyncCode(store.create(authority, plan), code);

    const tinyStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence(), maxArtifactBytes: 1 });
    await expectAsyncCode(
      tinyStore.create(authority, makeCreatePlan('declared_too_large', 1, 'still', Buffer.from('xx'))),
      'invalid_create_plan'
    );

    const invalidSourcePlans = [
      { ...verified, openVerifiedStream: async () => null },
      { ...verified, openVerifiedStream: async () => 1 },
      { ...verified, openVerifiedStream: async () => ({}) },
      {
        ...verified,
        openVerifiedStream: async () =>
          (async function* (): AsyncIterable<unknown> {
            yield 'not-bytes';
          })(),
      },
      {
        ...verified,
        openVerifiedStream: async () =>
          (async function* (): AsyncIterable<Uint8Array> {
            yield Buffer.from('xx');
          })(),
      },
    ];
    for (const [index, file] of invalidSourcePlans.entries()) {
      await expectAsyncCode(
        store.create(
          authority,
          asPlan({
            ...base,
            artifactId: `artifact_stream_${index}`,
            managedFileName: `managed_stream_${index}`,
            files: [file],
          })
        ),
        index < 3 ? 'invalid_create_plan' : 'storage_error'
      );
    }

    const invalidNonceStore = createStudioExportCatalogStoreV2({ createNonce: () => 'invalid nonce' });
    await expectAsyncCode(invalidNonceStore.create(authority, base), 'storage_error');
    await expect(fs.access(path.join(authority.projectDir, 'exports-v2.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('lists the absent logical catalog without writes, then publishes exact payload and sidecar bytes once', async () => {
    const authority = await makeAuthority();
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });

    await expect(store.list(authority)).resolves.toEqual({
      schemaVersion: 5,
      projectId: 'project_1',
      revision: 1,
      artifacts: [],
    });
    await expect(fs.readdir(authority.projectDir)).resolves.toEqual([]);

    const assertCurrent = vi.fn(async () => undefined);
    authority.assertCurrent = assertCurrent;
    const timeline = Buffer.from('{"timeline":true}');
    const media = Buffer.from('verified-media');
    const catalog = await store.create(authority, {
      expectedProjectRevision: 1,
      expectedCatalogRevision: 1,
      artifactId: 'artifact_editor',
      managedFileName: 'managed_editor',
      shape: 'editor_folder',
      createdAt: CREATED_AT,
      files: [
        { kind: 'generated', relativePath: 'timeline.json', bytes: timeline },
        {
          kind: 'verified_stream',
          relativePath: 'media/shot-001.mp4',
          byteSize: media.length,
          sha256: createHash('sha256').update(media).digest('hex'),
          openVerifiedStream: async () =>
            (async function* (): AsyncIterable<Uint8Array> {
              yield media.subarray(0, 4);
              yield media.subarray(4);
            })(),
        },
      ],
    });

    expect(assertCurrent).toHaveBeenCalledTimes(10);
    expect(catalog.revision).toBe(2);
    expect(catalog.artifacts).toHaveLength(1);
    const root = path.join(authority.projectDir, 'exports', 'managed_editor');
    expect(await fs.readFile(path.join(root, 'timeline.json'))).toEqual(timeline);
    expect(await fs.readFile(path.join(root, 'media', 'shot-001.mp4'))).toEqual(media);
    const artifactText = await fs.readFile(path.join(root, 'artifact.json'), 'utf8');
    expect(artifactText).toBe(JSON.stringify(catalog.artifacts[0]));
    const manifestText = await fs.readFile(path.join(root, 'manifest.json'), 'utf8');
    expect(JSON.parse(manifestText)).toEqual([
      {
        relativePath: 'media/shot-001.mp4',
        byteSize: media.length,
        sha256: createHash('sha256').update(media).digest('hex'),
      },
      {
        relativePath: 'timeline.json',
        byteSize: timeline.length,
        sha256: createHash('sha256').update(timeline).digest('hex'),
      },
    ]);
    expect(await fs.readFile(path.join(authority.projectDir, 'exports-v2.json'), 'utf8')).toBe(JSON.stringify(catalog));
    expect((await fs.readdir(authority.projectDir)).filter((entry) => entry.includes('.part'))).toEqual([]);
    await expect(store.list(authority)).resolves.toEqual(catalog);
  });

  it('refreshes without consuming Finder metadata at the exports and artifact roots', async () => {
    const authority = await makeAuthority();
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const catalog = await store.create(authority, {
      expectedProjectRevision: authority.project.revision,
      expectedCatalogRevision: 1,
      artifactId: 'artifact_finder_metadata',
      managedFileName: 'managed_finder_metadata',
      shape: 'editor_folder',
      createdAt: CREATED_AT,
      files: [
        { kind: 'generated', relativePath: 'timeline.json', bytes: Buffer.from('{"timeline":true}') },
        { kind: 'generated', relativePath: 'media/shot-001.mp4', bytes: Buffer.from('shot bytes') },
      ],
    });
    const activeRoot = path.join(authority.projectDir, 'exports');
    const artifactRoot = path.join(activeRoot, 'managed_finder_metadata');
    await fs.writeFile(path.join(activeRoot, '.DS_Store'), 'finder catalog metadata');
    await fs.writeFile(path.join(artifactRoot, '.DS_Store'), 'finder root metadata');
    await fs.writeFile(path.join(artifactRoot, 'media', '.DS_Store'), 'finder nested metadata');

    await expect(store.repair(authority)).resolves.toEqual(catalog);
    await expect(fs.readFile(path.join(activeRoot, '.DS_Store'), 'utf8')).resolves.toBe('finder catalog metadata');
    await expect(fs.readFile(path.join(artifactRoot, '.DS_Store'), 'utf8')).resolves.toBe('finder root metadata');
    await expect(fs.readFile(path.join(artifactRoot, 'media', '.DS_Store'), 'utf8')).resolves.toBe(
      'finder nested metadata'
    );
  });

  it('reveals an editor folder with Finder metadata at the exports and artifact roots', async () => {
    const authority = await makeAuthority();
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const catalog = await store.create(
      authority,
      makeCreatePlan('finder_reveal', 1, 'editor_folder', Buffer.from('{"timeline":true}'))
    );
    const activeRoot = path.join(authority.projectDir, 'exports');
    const artifactRoot = path.join(activeRoot, 'managed_finder_reveal');
    await fs.writeFile(path.join(activeRoot, '.DS_Store'), 'finder catalog metadata');
    await fs.writeFile(path.join(artifactRoot, '.DS_Store'), 'finder artifact metadata');

    await expect(
      store.resolveRevealPath(authority, {
        projectId: authority.project.id,
        expectedCatalogRevision: catalog.revision,
        artifactId: 'artifact_finder_reveal',
      })
    ).resolves.toBe(artifactRoot);
    await expect(fs.readFile(path.join(activeRoot, '.DS_Store'), 'utf8')).resolves.toBe('finder catalog metadata');
    await expect(fs.readFile(path.join(artifactRoot, '.DS_Store'), 'utf8')).resolves.toBe('finder artifact metadata');
  });

  it('copies only manifested payloads from an editor folder that contains Finder metadata', async () => {
    const authority = await makeAuthority();
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const catalog = await store.create(authority, {
      expectedProjectRevision: authority.project.revision,
      expectedCatalogRevision: 1,
      artifactId: 'artifact_finder_copy',
      managedFileName: 'managed_finder_copy',
      shape: 'editor_folder',
      createdAt: CREATED_AT,
      files: [
        { kind: 'generated', relativePath: 'timeline.json', bytes: Buffer.from('{"timeline":true}') },
        { kind: 'generated', relativePath: 'media/shot-001.mp4', bytes: Buffer.from('shot bytes') },
      ],
    });
    const artifactRoot = path.join(authority.projectDir, 'exports', 'managed_finder_copy');
    await fs.writeFile(path.join(artifactRoot, '.DS_Store'), 'finder root metadata');
    await fs.writeFile(path.join(artifactRoot, 'media', '.DS_Store'), 'finder nested metadata');
    const destinationPath = path.join(path.dirname(authority.projectDir), 'finder-copy');

    await expect(
      store.copy(
        authority,
        {
          projectId: authority.project.id,
          expectedCatalogRevision: catalog.revision,
          artifactId: 'artifact_finder_copy',
        },
        destinationPath
      )
    ).resolves.toEqual({ status: 'copied' });
    await expect(fs.readFile(path.join(destinationPath, 'media', 'shot-001.mp4'), 'utf8')).resolves.toBe('shot bytes');
    await expect(fs.access(path.join(destinationPath, '.DS_Store'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(path.join(destinationPath, 'media', '.DS_Store'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('publishes another export without adopting or deleting Finder metadata in the active catalog', async () => {
    const authority = await makeAuthority();
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const first = await store.create(authority, makeCreatePlan('finder_retained', 1));
    const activeRoot = path.join(authority.projectDir, 'exports');
    const artifactRoot = path.join(activeRoot, 'managed_finder_retained');
    await fs.writeFile(path.join(activeRoot, '.DS_Store'), 'finder catalog metadata');
    await fs.writeFile(path.join(artifactRoot, '.DS_Store'), 'finder artifact metadata');

    const second = await store.create(
      authority,
      makeCreatePlan(
        'after_finder_metadata',
        first.revision,
        'script',
        Buffer.from('# second\n'),
        '2026-08-20T00:00:01.000Z'
      )
    );

    expect(second.revision).toBe(first.revision + 1);
    expect(second.artifacts.map(({ id }) => id)).toEqual([
      'artifact_finder_retained',
      'artifact_after_finder_metadata',
    ]);
    await expect(fs.readFile(path.join(activeRoot, '.DS_Store'), 'utf8')).resolves.toBe('finder catalog metadata');
    await expect(fs.readFile(path.join(artifactRoot, '.DS_Store'), 'utf8')).resolves.toBe('finder artifact metadata');
    await expect(store.list(authority)).resolves.toEqual(second);
  });

  it.each([
    { target: 'active root', kind: 'symbolic link' },
    { target: 'active root', kind: 'directory' },
    { target: 'artifact root', kind: 'hard link' },
  ] as const)('rejects Finder metadata represented by a $kind at the $target', async ({ target, kind }) => {
    const authority = await makeAuthority();
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    await store.create(authority, makeCreatePlan(`unsafe_finder_${kind.replace(' ', '_')}`, 1));
    const activeRoot = path.join(authority.projectDir, 'exports');
    const artifactRoot = path.join(activeRoot, `managed_unsafe_finder_${kind.replace(' ', '_')}`);
    const sidecarPath = path.join(target === 'active root' ? activeRoot : artifactRoot, '.DS_Store');
    const payloadPath = path.join(artifactRoot, 'script.md');
    let sentinelPath: string | null = null;
    if (kind === 'symbolic link') await fs.symlink(payloadPath, sidecarPath);
    else if (kind === 'directory') await fs.mkdir(sidecarPath);
    else {
      sentinelPath = path.join(path.dirname(authority.projectDir), 'finder-hard-link-sentinel');
      await fs.writeFile(sentinelPath, 'external sentinel');
      await fs.link(sentinelPath, sidecarPath);
    }

    await expectAsyncCode(store.list(authority), 'storage_error');
    if (sentinelPath !== null) await expect(fs.readFile(sentinelPath, 'utf8')).resolves.toBe('external sentinel');
  });

  it.skipIf(process.platform === 'win32')(
    'rejects an active-root Finder metadata FIFO without waiting for a writer',
    async () => {
      const authority = await makeAuthority();
      const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
      await store.create(authority, makeCreatePlan('finder_fifo', 1));
      const sidecarPath = path.join(authority.projectDir, 'exports', '.DS_Store');
      execFileSync('mkfifo', [sidecarPath]);
      let unblockTriggered = false;
      let unblockPromise: Promise<void> | null = null;
      const unblockTimer = setTimeout(() => {
        unblockTriggered = true;
        unblockPromise = fs.open(sidecarPath, 'w').then(async (handle) => handle.close());
      }, 2_000);

      try {
        await expectAsyncCode(store.list(authority), 'storage_error');
      } finally {
        clearTimeout(unblockTimer);
        if (unblockPromise !== null) await unblockPromise;
      }
      expect(unblockTriggered).toBe(false);
    }
  );

  it('keeps a manifest-recorded .DS_Store under ordinary payload integrity', async () => {
    const authority = await makeAuthority();
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const original = Buffer.from('manifest-owned Finder-named payload');
    const catalog = await store.create(authority, {
      ...makeCreatePlan('manifested_finder_name', 1, 'script', original),
      files: [{ kind: 'generated', relativePath: '.DS_Store', bytes: original }],
    });
    const payloadPath = path.join(authority.projectDir, 'exports', 'managed_manifested_finder_name', '.DS_Store');

    await expect(store.list(authority)).resolves.toEqual(catalog);
    await fs.writeFile(payloadPath, Buffer.alloc(original.length, 120));
    await expectAsyncCode(store.list(authority), 'storage_error');
  });

  it('rejects Finder metadata changed after descendant validation, then accepts its next stable proof', async () => {
    const authority = await makeAuthority();
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const catalog = await store.create(authority, makeCreatePlan('finder_race', 1));
    const sidecarPath = path.join(authority.projectDir, 'exports', 'managed_finder_race', '.DS_Store');
    await fs.writeFile(sidecarPath, 'before');
    let changed = false;
    const racingStore = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step !== 'physical_catalog_descendants_validated' || changed) return;
        changed = true;
        await fs.writeFile(sidecarPath, 'after descendant validation');
      },
    });

    await expectAsyncCode(racingStore.list(authority), 'storage_error');
    expect(changed).toBe(true);
    await expect(store.list(authority)).resolves.toEqual(catalog);
  });

  it.each(['artifact_staged', 'artifact_published'] as const)(
    'rejects active-root Finder metadata changed at the $step create boundary',
    async (step) => {
      const authority = await makeAuthority();
      const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
      const catalog = await store.create(authority, makeCreatePlan(`finder_${step}_base`, 1));
      const sidecarPath = path.join(authority.projectDir, 'exports', '.DS_Store');
      await fs.writeFile(sidecarPath, 'before');
      let changed = false;
      const racingStore = createStudioExportCatalogStoreV2({
        createNonce: nonceSequence(),
        onStep: async (currentStep) => {
          if (currentStep !== step || changed) return;
          changed = true;
          await fs.writeFile(sidecarPath, `changed at ${step}`);
        },
      });

      await expectAsyncCode(
        racingStore.create(
          authority,
          makeCreatePlan(
            `finder_${step}_next`,
            catalog.revision,
            'script',
            Buffer.from('# next\n'),
            '2026-08-20T00:00:01.000Z'
          )
        ),
        'storage_error'
      );
      expect(changed).toBe(true);
      await expect(store.list(authority)).resolves.toEqual(catalog);
    }
  );

  it('holds validated retained-export byte facts across one managed-media authority callback', async () => {
    const authority = await makeAuthority();
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const catalog = await store.create(authority, makeCreatePlan('retained', 1, 'script', Buffer.from('# retained\n')));
    const artifact = catalog.artifacts[0]!;
    const artifactRoot = path.join(authority.projectDir, 'exports', artifact.managedExport.fileName);
    const expectedManagedBytes =
      (await fs.stat(path.join(authority.projectDir, 'exports-v2.json'))).size +
      artifact.byteSize +
      (await fs.stat(path.join(artifactRoot, 'manifest.json'))).size +
      (await fs.stat(path.join(artifactRoot, 'artifact.json'))).size;
    await fs.writeFile(path.join(authority.projectDir, 'exports', '.DS_Store'), Buffer.alloc(8 * 1024, 1));
    await fs.writeFile(path.join(artifactRoot, '.DS_Store'), Buffer.alloc(16 * 1024, 2));

    await expect(
      store.withManagedMediaAuthority(authority, async (facts) => {
        expect(facts).toEqual({ catalogRevision: catalog.revision, managedByteSize: expectedManagedBytes });
        expect(Object.isFrozen(facts)).toBe(true);
        return 'retention-held';
      })
    ).resolves.toBe('retention-held');
  });

  it('fences create and copy publication when the main service closes after staging', async () => {
    const createAuthority = await makeAuthority();
    let createActive = true;
    createAuthority.assertActive = () => {
      if (!createActive) throw new Error('service closed');
    };
    const closingCreate = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: (step) => {
        if (step === 'artifact_staged') createActive = false;
      },
    });

    await expectAsyncCode(closingCreate.create(createAuthority, makeCreatePlan('closed', 1)), 'storage_error');
    await expect(fs.access(path.join(createAuthority.projectDir, 'exports-v2.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(path.join(createAuthority.projectDir, 'exports'))).rejects.toMatchObject({ code: 'ENOENT' });

    const copyAuthority = await makeAuthority();
    const copyStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const catalog = await copyStore.create(copyAuthority, makeCreatePlan('copy_source', 1));
    let copyActive = true;
    copyAuthority.assertActive = () => {
      if (!copyActive) throw new Error('service closed');
    };
    const destination = path.join(path.dirname(copyAuthority.projectDir), 'closed-copy.md');
    await expectAsyncCode(
      copyStore.copy(
        copyAuthority,
        {
          projectId: copyAuthority.project.id,
          expectedCatalogRevision: catalog.revision,
          artifactId: catalog.artifacts[0]!.id,
        },
        async () => {
          copyActive = false;
          return destination;
        }
      ),
      'storage_error'
    );
    await expect(fs.access(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(path.dirname(destination))).some((entry) => entry.includes('closed-copy.md'))).toBe(false);
  });

  it('refuses stale revisions and stream substitution without publishing or replacing the catalog', async () => {
    const authority = await makeAuthority();
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const first = await store.create(authority, makeCreatePlan('one', 1));
    const originalCatalog = await fs.readFile(path.join(authority.projectDir, 'exports-v2.json'));

    await expectAsyncCode(store.create(authority, makeCreatePlan('stale', 1)), 'stale_catalog_revision');
    expect(await fs.readFile(path.join(authority.projectDir, 'exports-v2.json'))).toEqual(originalCatalog);
    expect(await fs.readdir(path.join(authority.projectDir, 'exports'))).toEqual(['managed_one']);

    const expected = Buffer.from('expected');
    await expectAsyncCode(
      store.create(authority, {
        expectedProjectRevision: 1,
        expectedCatalogRevision: first.revision,
        artifactId: 'artifact_substituted',
        managedFileName: 'managed_substituted',
        shape: 'still',
        createdAt: '2026-08-20T00:00:01.000Z',
        files: [
          {
            kind: 'verified_stream',
            relativePath: 'still.png',
            byteSize: expected.length,
            sha256: createHash('sha256').update(expected).digest('hex'),
            openVerifiedStream: async () =>
              (async function* (): AsyncIterable<Uint8Array> {
                yield Buffer.from('replaced');
              })(),
          },
        ],
      }),
      'storage_error'
    );
    await expect(store.list(authority)).resolves.toEqual(first);
    expect(await fs.readdir(path.join(authority.projectDir, 'exports'))).toEqual(['managed_one']);
  });

  it('counts payload, sidecars, catalog bytes, and current project media before active publication', async () => {
    const authority = await makeAuthority();
    authority.project.assets.import_1 = {
      id: 'import_1',
      projectId: authority.project.id,
      shotId: null,
      mediaKind: 'audio',
      mimeType: 'audio/wav',
      managedAsset: { collection: 'imports', fileName: 'import_1.wav' },
      byteSize: 32,
      sha256: 'a'.repeat(64),
      durationSeconds: 5,
      createdAt: CREATED_AT,
    };
    const store = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      maxProjectBytes: 64,
    });

    await expectAsyncCode(store.create(authority, makeCreatePlan('too_large', 1)), 'project_capacity_exceeded');
    await expect(fs.access(path.join(authority.projectDir, 'exports-v2.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(path.join(authority.projectDir, 'exports'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed for replaced bytes, symlinks, and cross-artifact hard links', async () => {
    const authority = await makeAuthority();
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const first = await store.create(authority, makeCreatePlan('one', 1, 'still', Buffer.from('same-bytes')));
    const second = await store.create(
      authority,
      makeCreatePlan('two', first.revision, 'still', Buffer.from('same-bytes'), '2026-08-20T00:00:01.000Z')
    );
    const firstPayload = path.join(authority.projectDir, 'exports', 'managed_one', 'still.png');
    const secondPayload = path.join(authority.projectDir, 'exports', 'managed_two', 'still.png');
    await fs.unlink(secondPayload);
    await fs.link(firstPayload, secondPayload);
    await expectAsyncCode(store.list(authority), 'storage_error');

    await fs.unlink(secondPayload);
    await fs.writeFile(secondPayload, 'same-bytes');
    await expect(store.list(authority)).resolves.toEqual(second);
    await fs.writeFile(secondPayload, 'substitute');
    await expectAsyncCode(store.list(authority), 'storage_error');

    await fs.unlink(secondPayload);
    await expectAsyncCode(store.list(authority), 'storage_error');
    await fs.symlink(firstPayload, secondPayload);
    await expectAsyncCode(store.list(authority), 'storage_error');
  });

  it.each([
    { target: 'catalog', operation: 'list' },
    { target: 'active directory', operation: 'create' },
    { target: 'artifact root', operation: 'reveal' },
    { target: 'nested payload directory', operation: 'list' },
    { target: 'artifact record', operation: 'create' },
    { target: 'manifest', operation: 'reveal' },
    { target: 'payload', operation: 'list' },
  ] as const)(
    'rejects an exact-clone $target replacement after descendant validation during $operation',
    async ({ target, operation }) => {
      const authority = await makeAuthority();
      const seedingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
      const timeline = Buffer.from('{"timeline":"physical-read-transaction"}');
      const media = Buffer.from('nested physical read payload');
      const catalog = await seedingStore.create(authority, {
        expectedProjectRevision: authority.project.revision,
        expectedCatalogRevision: 1,
        artifactId: 'artifact_physical_read',
        managedFileName: 'managed_physical_read',
        shape: 'editor_folder',
        createdAt: CREATED_AT,
        files: [
          { kind: 'generated', relativePath: 'timeline.json', bytes: timeline },
          { kind: 'generated', relativePath: 'media/nested/shot-001.mp4', bytes: media },
        ],
      });
      const catalogPath = path.join(authority.projectDir, 'exports-v2.json');
      const activePath = path.join(authority.projectDir, 'exports');
      const artifactRoot = path.join(activePath, 'managed_physical_read');
      const targetPaths = {
        catalog: catalogPath,
        'active directory': activePath,
        'artifact root': artifactRoot,
        'nested payload directory': path.join(artifactRoot, 'media', 'nested'),
        'artifact record': path.join(artifactRoot, 'artifact.json'),
        manifest: path.join(artifactRoot, 'manifest.json'),
        payload: path.join(artifactRoot, 'media', 'nested', 'shot-001.mp4'),
      } as const;
      const targetPath = targetPaths[target];
      const targetStats = await fs.lstat(targetPath);
      const scratchPath = path.join(path.dirname(authority.projectDir), `physical-read-${target.replaceAll(' ', '-')}`);
      const replacementPath = path.join(scratchPath, 'replacement');
      const displacedPath = path.join(scratchPath, 'displaced');
      await fs.mkdir(scratchPath);
      if (targetStats.isDirectory()) {
        await fs.cp(targetPath, replacementPath, { recursive: true });
      } else {
        await fs.copyFile(targetPath, replacementPath);
      }
      const catalogBytes = await fs.readFile(catalogPath);
      let replaced = false;
      const failingStore = createStudioExportCatalogStoreV2({
        createNonce: nonceSequence(),
        onStep: async (step) => {
          if (step !== 'physical_catalog_descendants_validated' || replaced) return;
          replaced = true;
          await fs.rename(targetPath, displacedPath);
          await fs.rename(replacementPath, targetPath);
        },
      });
      const request = {
        projectId: authority.project.id,
        expectedCatalogRevision: catalog.revision,
        artifactId: 'artifact_physical_read',
      };

      const result =
        operation === 'list'
          ? failingStore.list(authority)
          : operation === 'create'
            ? failingStore.create(authority, makeCreatePlan('rejected_after_physical_swap', catalog.revision))
            : failingStore.resolveRevealPath(authority, request);
      await expectAsyncCode(result, 'storage_error');

      expect(replaced).toBe(true);
      expect(await fs.readFile(catalogPath)).toEqual(catalogBytes);
      await expect(seedingStore.list(authority)).resolves.toEqual(catalog);
      await expect(fs.access(displacedPath)).resolves.toBeUndefined();
      await expect(fs.access(targetPath)).resolves.toBeUndefined();
      await expect(fs.access(path.join(activePath, 'managed_rejected_after_physical_swap'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  );

  it('rejects an absent catalog that appears after descendant validation before create can publish', async () => {
    const authority = await makeAuthority();
    const catalogPath = path.join(authority.projectDir, 'exports-v2.json');
    const scratchPath = path.join(path.dirname(authority.projectDir), 'appearing-catalog');
    const stagedCatalogPath = path.join(scratchPath, 'exports-v2.json');
    const logicalCatalog = createLogicalStudioExportCatalogV2(authority.project.id);
    await fs.mkdir(scratchPath);
    await fs.writeFile(
      stagedCatalogPath,
      serializeStudioExportCatalogV2(logicalCatalog, {
        projectId: authority.project.id,
        currentProjectRevision: authority.project.revision,
      })
    );
    let published = false;
    const failingStore = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step !== 'physical_catalog_descendants_validated' || published) return;
        published = true;
        await fs.rename(stagedCatalogPath, catalogPath);
      },
    });

    await expectAsyncCode(
      failingStore.create(authority, makeCreatePlan('rejected_after_catalog_appears', 1)),
      'storage_error'
    );

    expect(published).toBe(true);
    expect(await fs.readFile(catalogPath)).toEqual(
      serializeStudioExportCatalogV2(logicalCatalog, {
        projectId: authority.project.id,
        currentProjectRevision: authority.project.revision,
      })
    );
    await expect(fs.access(path.join(authority.projectDir, 'exports'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['payload_staged', 'artifact_staged', 'artifact_published'] as const)(
    'rejects and preserves an exact-clone staged tree replacement at %s',
    async (replacementStep) => {
      const authority = await makeAuthority();
      const scratchPath = path.join(path.dirname(authority.projectDir), `create-${replacementStep}-replacement`);
      const replacementPath = path.join(scratchPath, 'replacement');
      const displacedPath = path.join(scratchPath, 'displaced');
      const sentinelPath = path.join(scratchPath, 'external-sentinel.bin');
      const sentinel = Buffer.from(`external ${replacementStep} sentinel`);
      await fs.mkdir(scratchPath);
      await fs.writeFile(sentinelPath, sentinel);
      let targetPath: string | null = null;
      const failingStore = createStudioExportCatalogStoreV2({
        createNonce: nonceSequence(),
        onStep: async (step) => {
          if (step !== replacementStep || targetPath !== null) return;
          targetPath =
            step === 'artifact_published'
              ? path.join(authority.projectDir, 'exports', `managed_create_${replacementStep}`)
              : path.join(
                  authority.projectDir,
                  'exports-quarantine',
                  (await fs.readdir(path.join(authority.projectDir, 'exports-quarantine'))).find((name) =>
                    name.startsWith('stage-')
                  )!
                );
          await fs.cp(targetPath, replacementPath, { recursive: true });
          await fs.rename(targetPath, displacedPath);
          await fs.rename(replacementPath, targetPath);
        },
      });

      await expectAsyncCode(
        failingStore.create(
          authority,
          makeCreatePlan(`create_${replacementStep}`, 1, 'script', Buffer.from(`# ${replacementStep}\n`))
        ),
        'storage_error'
      );

      expect(targetPath).not.toBeNull();
      expect(await fs.readFile(path.join(targetPath!, 'script.md'), 'utf8')).toBe(`# ${replacementStep}\n`);
      expect(await fs.readFile(path.join(displacedPath, 'script.md'), 'utf8')).toBe(`# ${replacementStep}\n`);
      expect(await fs.readFile(sentinelPath)).toEqual(sentinel);
      await expect(fs.access(path.join(authority.projectDir, 'exports-v2.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  );

  it('rejects an exact-clone retained artifact replacement while a new artifact is staged', async () => {
    const authority = await makeAuthority();
    const seedingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const catalog = await seedingStore.create(authority, makeCreatePlan('retained_before_stage_swap', 1));
    const retainedPath = path.join(authority.projectDir, 'exports', 'managed_retained_before_stage_swap');
    const scratchPath = path.join(path.dirname(authority.projectDir), 'retained-stage-swap');
    const replacementPath = path.join(scratchPath, 'replacement');
    const displacedPath = path.join(scratchPath, 'displaced');
    await fs.mkdir(scratchPath);
    let replaced = false;
    const failingStore = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step !== 'artifact_staged' || replaced) return;
        await fs.cp(retainedPath, replacementPath, { recursive: true });
        await fs.rename(retainedPath, displacedPath);
        await fs.rename(replacementPath, retainedPath);
        replaced = true;
      },
    });

    await expectAsyncCode(
      failingStore.create(authority, makeCreatePlan('rejected_retained_stage_swap', catalog.revision)),
      'storage_error'
    );

    expect(replaced).toBe(true);
    await expect(seedingStore.list(authority)).resolves.toEqual(catalog);
    await expect(fs.access(displacedPath)).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(authority.projectDir, 'exports', 'managed_rejected_retained_stage_swap'))
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each([
    { currentCheck: 4, boundary: 'before artifact publication' },
    { currentCheck: 7, boundary: 'before catalog publication' },
  ] as const)('reproves retained artifact bytes after the final authority check $boundary', async (fixture) => {
    const authority = await makeAuthority();
    const seedingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const priorCatalog = await seedingStore.create(authority, makeCreatePlan('retained_authority_boundary', 1));
    const retainedPayload = path.join(
      authority.projectDir,
      'exports',
      'managed_retained_authority_boundary',
      'script.md'
    );
    const scratchPath = path.join(path.dirname(authority.projectDir), `retained-authority-${fixture.currentCheck}`);
    const replacementPath = path.join(scratchPath, 'replacement.md');
    const displacedPath = path.join(scratchPath, 'displaced.md');
    await fs.mkdir(scratchPath);
    let currentChecks = 0;
    authority.assertCurrent = async () => {
      currentChecks += 1;
      if (currentChecks !== fixture.currentCheck) return;
      await fs.copyFile(retainedPayload, replacementPath);
      await fs.rename(retainedPayload, displacedPath);
      await fs.rename(replacementPath, retainedPayload);
    };
    const failingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });

    await expectAsyncCode(
      failingStore.create(
        authority,
        makeCreatePlan(`rejected_authority_${fixture.currentCheck}`, priorCatalog.revision)
      ),
      'storage_error'
    );

    expect(currentChecks).toBe(fixture.currentCheck);
    authority.assertCurrent = undefined;
    await expect(seedingStore.list(authority)).resolves.toEqual(priorCatalog);
    expect(await fs.readFile(retainedPayload)).toEqual(await fs.readFile(displacedPath));
    await expect(
      fs.access(path.join(authority.projectDir, 'exports', `managed_rejected_authority_${fixture.currentCheck}`))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('copies and reveals a nested editor tree while keeping empty catalog maintenance revision-neutral', async () => {
    const emptyAuthority = await makeAuthority();
    const emptyStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    await expect(
      emptyStore.withManagedMediaAuthority(emptyAuthority, async (facts) => {
        expect(facts).toEqual({ catalogRevision: 1, managedByteSize: 0 });
        return 'empty-authority';
      })
    ).resolves.toBe('empty-authority');
    await expect(emptyStore.repair(emptyAuthority)).resolves.toEqual(
      createLogicalStudioExportCatalogV2(emptyAuthority.project.id)
    );
    await expectAsyncCode(
      emptyStore.withManagedMediaAuthority(
        emptyAuthority,
        null as unknown as (facts: { catalogRevision: number; managedByteSize: number }) => Promise<unknown>
      ),
      'storage_error'
    );

    const authority = await makeAuthority();
    authority.project.name = '***';
    const timeline = Buffer.from('{"timeline":"nested"}');
    const media = Buffer.from('nested-media');
    const secondMedia = Buffer.from('second-nested-media');
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const catalog = await store.create(authority, {
      expectedProjectRevision: authority.project.revision,
      expectedCatalogRevision: 1,
      artifactId: 'artifact_nested_editor',
      managedFileName: 'managed_nested_editor',
      shape: 'editor_folder',
      createdAt: CREATED_AT,
      files: [
        { kind: 'generated', relativePath: 'timeline.json', bytes: timeline },
        { kind: 'generated', relativePath: 'media/nested/shot-001.mp4', bytes: media },
        { kind: 'generated', relativePath: 'media/nested/shot-002.mp4', bytes: secondMedia },
      ],
    });
    const request = {
      projectId: authority.project.id,
      expectedCatalogRevision: catalog.revision,
      artifactId: 'artifact_nested_editor',
    };
    const parentPath = path.dirname(authority.projectDir);
    await expectAsyncCode(store.copy(authority, request, 'relative/editor-copy'), 'invalid_destination');
    const existingPath = path.join(parentPath, 'existing-editor-copy');
    await fs.mkdir(existingPath);
    await expectAsyncCode(store.copy(authority, request, existingPath), 'invalid_destination');

    const destinationPath = path.join(parentPath, 'nested-editor-copy');
    const picker = vi.fn(async () => destinationPath);
    await expect(store.copy(authority, request, picker)).resolves.toEqual({ status: 'copied' });
    expect(picker).toHaveBeenCalledWith({
      artifactId: 'artifact_nested_editor',
      shape: 'editor_folder',
      payloadKind: 'directory',
      suggestedName: 'studio-editor-folder',
    });
    expect(await fs.readFile(path.join(destinationPath, 'timeline.json'))).toEqual(timeline);
    expect(await fs.readFile(path.join(destinationPath, 'media', 'nested', 'shot-001.mp4'))).toEqual(media);
    expect(await fs.readFile(path.join(destinationPath, 'media', 'nested', 'shot-002.mp4'))).toEqual(secondMedia);
    await expect(store.resolveRevealPath(authority, request)).resolves.toBe(
      path.join(authority.projectDir, 'exports', 'managed_nested_editor')
    );
  });

  it('fails closed at missing roots, substituted sidecars, unmanifested payloads, and non-directory roots', async () => {
    const missingRootAuthority = await makeAuthority();
    const missingRootStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    await missingRootStore.create(missingRootAuthority, makeCreatePlan('missing_root', 1));
    await fs.rename(
      path.join(missingRootAuthority.projectDir, 'exports'),
      path.join(missingRootAuthority.projectDir, 'displaced-exports')
    );
    await expectAsyncCode(missingRootStore.list(missingRootAuthority), 'storage_error');

    const artifactRecordAuthority = await makeAuthority();
    const artifactRecordStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    await artifactRecordStore.create(artifactRecordAuthority, makeCreatePlan('artifact_record', 1));
    await fs.writeFile(
      path.join(artifactRecordAuthority.projectDir, 'exports', 'managed_artifact_record', 'artifact.json'),
      '{}'
    );
    await expectAsyncCode(artifactRecordStore.list(artifactRecordAuthority), 'storage_error');

    const manifestAuthority = await makeAuthority();
    const manifestStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const manifestBody = Buffer.from('# manifest substitution\n');
    await manifestStore.create(manifestAuthority, makeCreatePlan('manifest_record', 1, 'script', manifestBody));
    await fs.writeFile(
      path.join(manifestAuthority.projectDir, 'exports', 'managed_manifest_record', 'manifest.json'),
      JSON.stringify([{ relativePath: 'script.md', byteSize: manifestBody.length, sha256: 'b'.repeat(64) }])
    );
    await expectAsyncCode(manifestStore.list(manifestAuthority), 'storage_error');

    const extraPayloadAuthority = await makeAuthority();
    const extraPayloadStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    await extraPayloadStore.create(extraPayloadAuthority, makeCreatePlan('extra_payload', 1));
    await fs.writeFile(
      path.join(extraPayloadAuthority.projectDir, 'exports', 'managed_extra_payload', 'unmanifested.bin'),
      'foreign'
    );
    await expectAsyncCode(extraPayloadStore.list(extraPayloadAuthority), 'storage_error');
    await fs.unlink(
      path.join(extraPayloadAuthority.projectDir, 'exports', 'managed_extra_payload', 'unmanifested.bin')
    );
    await fs.writeFile(
      path.join(extraPayloadAuthority.projectDir, 'exports', 'managed_extra_payload', '.DS_Store.bak'),
      'not allowlisted Finder metadata'
    );
    await expectAsyncCode(extraPayloadStore.list(extraPayloadAuthority), 'storage_error');

    const catalogDirectoryAuthority = await makeAuthority();
    await fs.mkdir(path.join(catalogDirectoryAuthority.projectDir, 'exports-v2.json'));
    await expectAsyncCode(
      createStudioExportCatalogStoreV2({ createNonce: nonceSequence() }).list(catalogDirectoryAuthority),
      'storage_error'
    );

    const symlinkedActiveAuthority = await makeAuthority();
    const externalDirectory = path.join(path.dirname(symlinkedActiveAuthority.projectDir), 'external-active-root');
    await fs.mkdir(externalDirectory);
    await fs.symlink(externalDirectory, path.join(symlinkedActiveAuthority.projectDir, 'exports'), 'dir');
    await expectAsyncCode(
      createStudioExportCatalogStoreV2({ createNonce: nonceSequence() }).list(symlinkedActiveAuthority),
      'storage_error'
    );
  });

  it('copies through a main-owned destination, cancels without writes, and resolves only current catalog IDs', async () => {
    const authority = await makeAuthority();
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const body = Buffer.from('# Script\n');
    const catalog = await store.create(authority, makeCreatePlan('script', 1, 'script', body));
    const request = {
      projectId: authority.project.id,
      expectedCatalogRevision: catalog.revision,
      artifactId: 'artifact_script',
    };
    const picker = vi.fn(async () => null);
    await expect(store.copy(authority, request, picker)).resolves.toEqual({ status: 'cancelled' });
    expect(picker).toHaveBeenCalledWith({
      artifactId: 'artifact_script',
      shape: 'script',
      payloadKind: 'file',
      suggestedName: 'script.md',
    });
    await expectAsyncCode(
      store.copy(authority, request, path.join(authority.projectDir, '..evil', 'copied-script.md')),
      'invalid_destination'
    );

    const destinationPath = path.join(path.dirname(authority.projectDir), 'copied-script.md');
    await expect(store.copy(authority, request, destinationPath)).resolves.toEqual({ status: 'copied' });
    expect(await fs.readFile(destinationPath)).toEqual(body);
    await expect(store.resolveRevealPath(authority, request)).resolves.toBe(
      path.join(authority.projectDir, 'exports', 'managed_script', 'script.md')
    );
    await expectAsyncCode(
      store.resolveRevealPath(authority, { ...request, expectedCatalogRevision: 1 }),
      'stale_catalog_revision'
    );
    await expectAsyncCode(
      store.resolveRevealPath(authority, { ...request, artifactId: 'artifact_missing' }),
      'artifact_not_found'
    );
  });

  it('refuses a copy when the picker exact-clone replaces the initially proved source', async () => {
    const authority = await makeAuthority();
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const body = Buffer.from('# Picker source continuity\n');
    const catalog = await store.create(authority, makeCreatePlan('picker_source', 1, 'script', body));
    const sourcePath = path.join(authority.projectDir, 'exports', 'managed_picker_source', 'script.md');
    const scratchPath = path.join(path.dirname(authority.projectDir), 'picker-source-swap');
    const replacementPath = path.join(scratchPath, 'replacement.md');
    const displacedPath = path.join(scratchPath, 'displaced.md');
    const destinationPath = path.join(path.dirname(authority.projectDir), 'picker-source-copy.md');
    await fs.mkdir(scratchPath);
    const picker = vi.fn(async () => {
      await fs.copyFile(sourcePath, replacementPath);
      await fs.rename(sourcePath, displacedPath);
      await fs.rename(replacementPath, sourcePath);
      return destinationPath;
    });

    await expectAsyncCode(
      store.copy(
        authority,
        {
          projectId: authority.project.id,
          expectedCatalogRevision: catalog.revision,
          artifactId: 'artifact_picker_source',
        },
        picker
      ),
      'storage_error'
    );

    expect(picker).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(sourcePath)).toEqual(body);
    expect(await fs.readFile(displacedPath)).toEqual(body);
    await expect(fs.access(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(store.list(authority)).resolves.toEqual(catalog);
  });

  it('refuses reveal when the retained artifact is exact-clone replaced between physical reads', async () => {
    const authority = await makeAuthority();
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const catalog = await store.create(authority, makeCreatePlan('reveal_source', 1));
    const sourceRoot = path.join(authority.projectDir, 'exports', 'managed_reveal_source');
    const scratchPath = path.join(path.dirname(authority.projectDir), 'reveal-source-swap');
    const replacementPath = path.join(scratchPath, 'replacement');
    const displacedPath = path.join(scratchPath, 'displaced');
    await fs.mkdir(scratchPath);
    let currentChecks = 0;
    authority.assertCurrent = async () => {
      currentChecks += 1;
      if (currentChecks !== 3) return;
      await fs.cp(sourceRoot, replacementPath, { recursive: true });
      await fs.rename(sourceRoot, displacedPath);
      await fs.rename(replacementPath, sourceRoot);
    };

    await expectAsyncCode(
      store.resolveRevealPath(authority, {
        projectId: authority.project.id,
        expectedCatalogRevision: catalog.revision,
        artifactId: 'artifact_reveal_source',
      }),
      'storage_error'
    );

    expect(currentChecks).toBe(4);
    authority.assertCurrent = undefined;
    await expect(store.list(authority)).resolves.toEqual(catalog);
    expect(await fs.readFile(path.join(sourceRoot, 'script.md'))).toEqual(
      await fs.readFile(path.join(displacedPath, 'script.md'))
    );
  });

  it('falls back to an exclusive verified file copy when the destination filesystem cannot hard-link', async () => {
    const authority = await makeAuthority();
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const body = Buffer.from('# Portable copy\n');
    const catalog = await store.create(authority, makeCreatePlan('portable_copy', 1, 'script', body));
    const destinationPath = path.join(path.dirname(authority.projectDir), 'portable-copy.md');
    const hardLinkUnavailable = Object.assign(new Error('hard links unavailable'), { code: 'ENOTSUP' });
    const link = vi.spyOn(fs, 'link').mockRejectedValueOnce(hardLinkUnavailable);

    try {
      await expect(
        store.copy(
          authority,
          {
            projectId: authority.project.id,
            expectedCatalogRevision: catalog.revision,
            artifactId: 'artifact_portable_copy',
          },
          destinationPath
        )
      ).resolves.toEqual({ status: 'copied' });

      expect(link).toHaveBeenCalledTimes(1);
      expect(await fs.readFile(destinationPath)).toEqual(body);
      expect(
        (await fs.readdir(path.dirname(destinationPath))).filter(
          (entry) => entry.startsWith('.portable-copy.md-') || entry.endsWith('.cleanup')
        )
      ).toEqual([]);
    } finally {
      link.mockRestore();
    }
  });

  it('refuses a file publication when the validated destination parent becomes a symlink at fs.link', async () => {
    const authority = await makeAuthority();
    const rootPath = path.dirname(authority.projectDir);
    const parentPath = path.join(rootPath, 'authorized-file-copy-parent');
    const displacedParentPath = path.join(rootPath, 'displaced-file-copy-parent');
    const destinationPath = path.join(parentPath, 'publication-boundary.md');
    const sentinelPath = path.join(parentPath, 'external-sentinel.bin');
    const sentinel = Buffer.from('file parent replacement sentinel');
    const body = Buffer.from('# Parent-authorized file copy\n');
    await fs.mkdir(parentPath);
    await fs.writeFile(sentinelPath, sentinel);
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const catalog = await store.create(authority, makeCreatePlan('file_parent_publication', 1, 'script', body));
    const realLink = fs.link;
    let temporaryName: string | null = null;
    const link = vi.spyOn(fs, 'link').mockImplementationOnce(async (sourcePath, publishedPath) => {
      expect(publishedPath).toBe(destinationPath);
      expect(typeof sourcePath).toBe('string');
      temporaryName = path.basename(sourcePath.toString());
      await fs.rename(parentPath, displacedParentPath);
      await fs.symlink(displacedParentPath, parentPath, 'dir');
      await realLink(sourcePath, publishedPath);
    });

    try {
      await expectAsyncCode(
        store.copy(
          authority,
          {
            projectId: authority.project.id,
            expectedCatalogRevision: catalog.revision,
            artifactId: 'artifact_file_parent_publication',
          },
          destinationPath
        ),
        'storage_error'
      );

      expect(link).toHaveBeenCalledTimes(1);
      expect(temporaryName).not.toBeNull();
      expect((await fs.lstat(parentPath)).isSymbolicLink()).toBe(true);
      expect(await fs.readFile(path.join(displacedParentPath, 'external-sentinel.bin'))).toEqual(sentinel);
      expect(await fs.readFile(path.join(displacedParentPath, temporaryName!))).toEqual(body);
      expect(await fs.readFile(path.join(displacedParentPath, path.basename(destinationPath)))).toEqual(body);
      expect((await fs.lstat(path.join(displacedParentPath, temporaryName!))).nlink).toBe(2);
      await expect(store.list(authority)).resolves.toEqual(catalog);
    } finally {
      link.mockRestore();
    }
  });

  it('refuses a directory publication when fs.mkdir replaces the validated parent with a foreign directory', async () => {
    const authority = await makeAuthority();
    const rootPath = path.dirname(authority.projectDir);
    const parentPath = path.join(rootPath, 'authorized-directory-copy-parent');
    const displacedParentPath = path.join(rootPath, 'displaced-directory-copy-parent');
    const destinationPath = path.join(parentPath, 'publication-boundary-editor');
    const sentinelPath = path.join(parentPath, 'external-sentinel.bin');
    const sentinel = Buffer.from('directory parent replacement sentinel');
    const timeline = Buffer.from('{"timeline":"parent-authorized"}');
    await fs.mkdir(parentPath);
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const catalog = await store.create(
      authority,
      makeCreatePlan('directory_parent_publication', 1, 'editor_folder', timeline)
    );
    const realMkdir = fs.mkdir;
    let boundaryReplaced = false;
    let temporaryName: string | null = null;
    const mkdir = vi.spyOn(fs, 'mkdir').mockImplementation(async (targetPath, options) => {
      if (targetPath === destinationPath && !boundaryReplaced) {
        const entries = await fs.readdir(parentPath);
        const candidates = entries.filter(
          (entry) => entry.startsWith('.publication-boundary-editor-') && entry.endsWith('.part')
        );
        expect(candidates).toHaveLength(1);
        temporaryName = candidates[0]!;
        await fs.rename(parentPath, displacedParentPath);
        await realMkdir(parentPath, { mode: 0o700 });
        await fs.rename(path.join(displacedParentPath, temporaryName), path.join(parentPath, temporaryName));
        await fs.writeFile(sentinelPath, sentinel);
        boundaryReplaced = true;
      }
      return realMkdir(targetPath, options);
    });

    try {
      await expectAsyncCode(
        store.copy(
          authority,
          {
            projectId: authority.project.id,
            expectedCatalogRevision: catalog.revision,
            artifactId: 'artifact_directory_parent_publication',
          },
          destinationPath
        ),
        'storage_error'
      );

      expect(boundaryReplaced).toBe(true);
      expect(temporaryName).not.toBeNull();
      expect((await fs.lstat(parentPath)).isDirectory()).toBe(true);
      expect((await fs.lstat(parentPath)).isSymbolicLink()).toBe(false);
      expect(await fs.readFile(sentinelPath)).toEqual(sentinel);
      expect(await fs.readFile(path.join(parentPath, temporaryName!, 'timeline.json'))).toEqual(timeline);
      expect(await fs.readFile(path.join(destinationPath, 'timeline.json'))).toEqual(timeline);
      await expect(store.list(authority)).resolves.toEqual(catalog);
    } finally {
      mkdir.mockRestore();
    }
  });

  it('never cleans a foreign file that replaces the closed copy temp before publication', async () => {
    const authority = await makeAuthority();
    const parentPath = path.dirname(authority.projectDir);
    const destinationPath = path.join(parentPath, 'replaced-file-copy.md');
    const displacedPath = path.join(parentPath, 'displaced-owned-file-copy.md');
    const body = Buffer.from('# Copy source\n');
    const foreignBytes = Buffer.from('foreign replacement');
    let replacementPath: string | null = null;
    const store = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step !== 'copy_temp_closed') return;
        const candidates = (await fs.readdir(parentPath)).filter(
          (entry) => entry.startsWith('.replaced-file-copy.md-') && entry.endsWith('.part')
        );
        expect(candidates).toHaveLength(1);
        replacementPath = path.join(parentPath, candidates[0]!);
        await fs.rename(replacementPath, displacedPath);
        await fs.writeFile(replacementPath, foreignBytes);
        throw new Error('induced error after copy handles closed');
      },
    });
    const catalog = await store.create(authority, makeCreatePlan('copy_file_swap', 1, 'script', body));

    await expectAsyncCode(
      store.copy(
        authority,
        {
          projectId: authority.project.id,
          expectedCatalogRevision: catalog.revision,
          artifactId: 'artifact_copy_file_swap',
        },
        destinationPath
      ),
      'storage_error'
    );

    expect(replacementPath).not.toBeNull();
    await expect(fs.access(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(displacedPath)).toEqual(body);
    expect(await fs.readFile(replacementPath!)).toEqual(foreignBytes);
    expect((await fs.readdir(parentPath)).filter((entry) => entry.endsWith('.cleanup'))).toEqual([]);
    await expect(store.list(authority)).resolves.toEqual(catalog);
  });

  it('never recursively cleans a foreign tree that replaces the closed directory copy temp', async () => {
    const authority = await makeAuthority();
    const parentPath = path.dirname(authority.projectDir);
    const destinationPath = path.join(parentPath, 'replaced-editor-copy');
    const displacedPath = path.join(parentPath, 'displaced-owned-editor-copy');
    const timeline = Buffer.from('{"timeline":"owned"}');
    const foreignBytes = Buffer.from('foreign nested sentinel');
    let replacementPath: string | null = null;
    const store = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step !== 'copy_temp_closed') return;
        const candidates = (await fs.readdir(parentPath)).filter(
          (entry) => entry.startsWith('.replaced-editor-copy-') && entry.endsWith('.part')
        );
        expect(candidates).toHaveLength(1);
        replacementPath = path.join(parentPath, candidates[0]!);
        await fs.rename(replacementPath, displacedPath);
        await fs.mkdir(path.join(replacementPath, 'foreign', 'nested'), { recursive: true });
        await fs.writeFile(path.join(replacementPath, 'foreign', 'nested', 'sentinel.bin'), foreignBytes);
        throw new Error('induced error after directory copy handles closed');
      },
    });
    const catalog = await store.create(authority, makeCreatePlan('copy_directory_swap', 1, 'editor_folder', timeline));

    await expectAsyncCode(
      store.copy(
        authority,
        {
          projectId: authority.project.id,
          expectedCatalogRevision: catalog.revision,
          artifactId: 'artifact_copy_directory_swap',
        },
        destinationPath
      ),
      'storage_error'
    );

    expect(replacementPath).not.toBeNull();
    await expect(fs.access(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(displacedPath, 'timeline.json'))).toEqual(timeline);
    expect(await fs.readFile(path.join(replacementPath!, 'foreign', 'nested', 'sentinel.bin'))).toEqual(foreignBytes);
    expect((await fs.readdir(parentPath)).filter((entry) => entry.endsWith('.cleanup'))).toEqual([]);
    await expect(store.list(authority)).resolves.toEqual(catalog);
  });

  it('preserves a destination installed after temp reproof instead of overwriting it', async () => {
    const authority = await makeAuthority();
    const parentPath = path.dirname(authority.projectDir);
    const destinationPath = path.join(parentPath, 'raced-copy-destination.md');
    const foreignBytes = Buffer.from('foreign destination installed during publication');
    const store = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step === 'copy_temp_reproved') await fs.writeFile(destinationPath, foreignBytes, { flag: 'wx' });
      },
    });
    const catalog = await store.create(authority, makeCreatePlan('copy_destination_race', 1));

    await expectAsyncCode(
      store.copy(
        authority,
        {
          projectId: authority.project.id,
          expectedCatalogRevision: catalog.revision,
          artifactId: 'artifact_copy_destination_race',
        },
        destinationPath
      ),
      'invalid_destination'
    );

    expect(await fs.readFile(destinationPath)).toEqual(foreignBytes);
    expect(
      (await fs.readdir(parentPath)).filter(
        (entry) => entry.startsWith('.raced-copy-destination.md-') || entry.endsWith('.cleanup')
      )
    ).toEqual([]);
    await expect(store.list(authority)).resolves.toEqual(catalog);
  });

  it.each([
    { shape: 'script' as const, destinationName: 'final-assert-race.md', foreignName: '' },
    {
      shape: 'editor_folder' as const,
      destinationName: 'final-assert-race-editor',
      foreignName: 'foreign-sentinel.bin',
    },
  ])('atomically refuses a foreign $shape destination created by the final activity assertion', async (fixture) => {
    const authority = await makeAuthority();
    const parentPath = path.dirname(authority.projectDir);
    const destinationPath = path.join(parentPath, fixture.destinationName);
    const foreignPath =
      fixture.foreignName.length === 0 ? destinationPath : path.join(destinationPath, fixture.foreignName);
    const foreignBytes = Buffer.from(`foreign ${fixture.shape} destination from final assertion`);
    let finalAssertionInstalledDestination = false;
    let tempWasReproved = false;
    const store = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: (step) => {
        if (step === 'copy_temp_reproved') tempWasReproved = true;
      },
    });
    const catalog = await store.create(authority, makeCreatePlan(`final_assert_${fixture.shape}`, 1, fixture.shape));
    authority.assertActive = () => {
      if (!tempWasReproved || finalAssertionInstalledDestination) return;
      if (fixture.shape === 'editor_folder') mkdirSync(destinationPath);
      writeFileSync(foreignPath, foreignBytes, { flag: 'wx' });
      finalAssertionInstalledDestination = true;
    };

    await expectAsyncCode(
      store.copy(
        authority,
        {
          projectId: authority.project.id,
          expectedCatalogRevision: catalog.revision,
          artifactId: `artifact_final_assert_${fixture.shape}`,
        },
        destinationPath
      ),
      'invalid_destination'
    );

    expect(finalAssertionInstalledDestination).toBe(true);
    expect(await fs.readFile(foreignPath)).toEqual(foreignBytes);
    expect(
      (await fs.readdir(parentPath)).filter(
        (entry) => entry.startsWith(`.${fixture.destinationName}-`) || entry.endsWith('.cleanup')
      )
    ).toEqual([]);
    await expect(store.list(authority)).resolves.toEqual(catalog);
  });

  it('refuses and preserves an in-place payload mutation after a directory copy closes', async () => {
    const authority = await makeAuthority();
    const parentPath = path.dirname(authority.projectDir);
    const destinationPath = path.join(parentPath, 'mutated-editor-copy');
    const ownedBytes = Buffer.from('owned-payload');
    const replacedBytes = Buffer.from('evil!-payload');
    let temporaryPath: string | null = null;
    const store = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step !== 'copy_temp_closed') return;
        const candidates = (await fs.readdir(parentPath)).filter(
          (entry) => entry.startsWith('.mutated-editor-copy-') && entry.endsWith('.part')
        );
        expect(candidates).toHaveLength(1);
        temporaryPath = path.join(parentPath, candidates[0]!);
        await fs.writeFile(path.join(temporaryPath, 'timeline.json'), replacedBytes);
      },
    });
    const catalog = await store.create(
      authority,
      makeCreatePlan('copy_payload_mutation', 1, 'editor_folder', ownedBytes)
    );

    await expectAsyncCode(
      store.copy(
        authority,
        {
          projectId: authority.project.id,
          expectedCatalogRevision: catalog.revision,
          artifactId: 'artifact_copy_payload_mutation',
        },
        destinationPath
      ),
      'storage_error'
    );

    expect(temporaryPath).not.toBeNull();
    await expect(fs.access(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(temporaryPath!, 'timeline.json'))).toEqual(replacedBytes);
    expect((await fs.readdir(parentPath)).filter((entry) => entry.endsWith('.cleanup'))).toEqual([]);
    await expect(store.list(authority)).resolves.toEqual(catalog);
  });

  it('refuses and preserves a nested insertion after a directory copy closes', async () => {
    const authority = await makeAuthority();
    const parentPath = path.dirname(authority.projectDir);
    const destinationPath = path.join(parentPath, 'extended-editor-copy');
    const foreignBytes = Buffer.from('foreign nested copy insertion');
    let temporaryPath: string | null = null;
    const store = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step !== 'copy_temp_closed') return;
        const candidates = (await fs.readdir(parentPath)).filter(
          (entry) => entry.startsWith('.extended-editor-copy-') && entry.endsWith('.part')
        );
        expect(candidates).toHaveLength(1);
        temporaryPath = path.join(parentPath, candidates[0]!);
        const foreignDirectory = path.join(temporaryPath, 'foreign', 'nested');
        await fs.mkdir(foreignDirectory, { recursive: true });
        await fs.writeFile(path.join(foreignDirectory, 'sentinel.bin'), foreignBytes);
      },
    });
    const catalog = await store.create(authority, makeCreatePlan('copy_nested_insertion', 1, 'editor_folder'));

    await expectAsyncCode(
      store.copy(
        authority,
        {
          projectId: authority.project.id,
          expectedCatalogRevision: catalog.revision,
          artifactId: 'artifact_copy_nested_insertion',
        },
        destinationPath
      ),
      'storage_error'
    );

    expect(temporaryPath).not.toBeNull();
    await expect(fs.access(destinationPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(temporaryPath!, 'foreign', 'nested', 'sentinel.bin'))).toEqual(foreignBytes);
    expect((await fs.readdir(parentPath)).filter((entry) => entry.endsWith('.cleanup'))).toEqual([]);
    await expect(store.list(authority)).resolves.toEqual(catalog);
  });

  it.each(['script', 'still', 'editor_folder'] as const)(
    'retains the newest five $shape exports and leaves eviction in export-only quarantine for repair',
    async (shape) => {
      const authority = await makeAuthority();
      const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
      await fs.mkdir(path.join(authority.projectDir, 'assets'));
      await fs.writeFile(path.join(authority.projectDir, 'assets', 'sentinel.bin'), 'do-not-touch');
      let revision = 1;
      let catalog!: StudioExportCatalogV2;
      for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
        catalog = await store.create(authority, makeCreatePlan(id, revision, shape));
        revision = catalog.revision;
      }
      expect(catalog.artifacts.map(({ id }) => id)).toEqual([
        'artifact_b',
        'artifact_c',
        'artifact_d',
        'artifact_e',
        'artifact_f',
      ]);
      await expect(fs.access(path.join(authority.projectDir, 'exports', 'managed_a'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await fs.readdir(path.join(authority.projectDir, 'exports-quarantine'))).toHaveLength(1);

      await store.repair(authority);
      expect(await fs.readdir(path.join(authority.projectDir, 'exports-quarantine'))).toEqual([]);
      expect(await fs.readFile(path.join(authority.projectDir, 'assets', 'sentinel.bin'), 'utf8')).toBe('do-not-touch');
      await expect(store.list(authority)).resolves.toEqual(catalog);
    }
  );

  it.each(['script', 'still', 'editor_folder'] as const)(
    'commits an equal-time lower-ID $shape publication even when that new artifact immediately self-evicts',
    async (shape) => {
      const authority = await makeAuthority();
      const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
      let revision = 1;
      let catalog!: StudioExportCatalogV2;
      for (const id of ['b', 'c', 'd', 'e', 'f']) {
        catalog = await store.create(authority, makeCreatePlan(id, revision, shape));
        revision = catalog.revision;
      }

      const afterSelfEviction = await store.create(authority, makeCreatePlan('a', revision, shape));

      expect(afterSelfEviction.revision).toBe(catalog.revision + 1);
      expect(afterSelfEviction.artifacts.map(({ id }) => id)).toEqual([
        'artifact_b',
        'artifact_c',
        'artifact_d',
        'artifact_e',
        'artifact_f',
      ]);
      await expect(fs.access(path.join(authority.projectDir, 'exports', 'managed_a'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await fs.readdir(path.join(authority.projectDir, 'exports-quarantine'))).toHaveLength(1);
      await expect(store.list(authority)).resolves.toEqual(afterSelfEviction);
    }
  );

  it('repairs only unreferenced exports, stays revision-neutral, and refuses missing referenced bytes', async () => {
    const authority = await makeAuthority();
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const catalog = await store.create(authority, makeCreatePlan('kept', 1));
    const orphanPath = path.join(authority.projectDir, 'exports', 'hostile-orphan');
    await fs.mkdir(orphanPath);
    await fs.writeFile(path.join(orphanPath, 'payload'), 'untrusted');

    await expect(store.repair(authority)).resolves.toEqual(catalog);
    await expect(fs.access(orphanPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(path.join(authority.projectDir, 'exports-quarantine'))).toHaveLength(1);
    expect((await store.list(authority)).revision).toBe(catalog.revision);
    await store.repair(authority);
    expect(await fs.readdir(path.join(authority.projectDir, 'exports-quarantine'))).toEqual([]);

    await fs.rename(
      path.join(authority.projectDir, 'exports', 'managed_kept'),
      path.join(authority.projectDir, 'exports', 'missing-reference')
    );
    await expectAsyncCode(store.repair(authority), 'storage_error');
    expect(JSON.parse(await fs.readFile(path.join(authority.projectDir, 'exports-v2.json'), 'utf8'))).toEqual(catalog);
    await expect(fs.access(path.join(authority.projectDir, 'exports', 'missing-reference'))).resolves.toBeUndefined();
  });

  it('rejects an exact-clone retained artifact replacement during quarantine cleanup', async () => {
    const authority = await makeAuthority();
    const seedingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const catalog = await seedingStore.create(authority, makeCreatePlan('repair_retained', 1));
    const catalogBytes = await fs.readFile(path.join(authority.projectDir, 'exports-v2.json'));
    const quarantinePath = path.join(authority.projectDir, 'exports-quarantine');
    const reapPath = path.join(quarantinePath, 'reap-this-tree');
    await fs.mkdir(path.join(reapPath, 'nested'), { recursive: true });
    await fs.writeFile(path.join(reapPath, 'nested', 'owned.bin'), 'owned quarantine data');
    const retainedPath = path.join(authority.projectDir, 'exports', 'managed_repair_retained');
    const scratchPath = path.join(path.dirname(authority.projectDir), 'repair-retained-swap');
    const replacementPath = path.join(scratchPath, 'replacement');
    const displacedPath = path.join(scratchPath, 'displaced');
    await fs.mkdir(scratchPath);
    let replaced = false;
    const failingStore = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step !== 'quarantine_directory_opened' || replaced) return;
        await fs.cp(retainedPath, replacementPath, { recursive: true });
        await fs.rename(retainedPath, displacedPath);
        await fs.rename(replacementPath, retainedPath);
        replaced = true;
      },
    });

    await expectAsyncCode(failingStore.repair(authority), 'storage_error');

    expect(replaced).toBe(true);
    expect(await fs.readFile(path.join(authority.projectDir, 'exports-v2.json'))).toEqual(catalogBytes);
    await expect(seedingStore.list(authority)).resolves.toEqual(catalog);
    expect(await fs.readFile(path.join(retainedPath, 'script.md'))).toEqual(
      await fs.readFile(path.join(displacedPath, 'script.md'))
    );
  });

  it('refuses a cleanup claim parent replaced by an external symlink before quarantine rename', async () => {
    const authority = await makeAuthority();
    const quarantinePath = path.join(authority.projectDir, 'exports-quarantine');
    const ownedPath = path.join(quarantinePath, 'owned-entry');
    const externalPath = path.join(path.dirname(authority.projectDir), 'external-cleanup-claim');
    const externalEntryPath = path.join(externalPath, 'entry');
    const sentinel = Buffer.from('external cleanup claim sentinel');
    const scratchPath = path.join(path.dirname(authority.projectDir), 'cleanup-claim-scratch');
    const displacedClaim = path.join(scratchPath, 'displaced-claim');
    await fs.mkdir(quarantinePath);
    await fs.writeFile(ownedPath, 'owned quarantine entry');
    await fs.mkdir(externalPath);
    await fs.writeFile(externalEntryPath, sentinel);
    await fs.mkdir(scratchPath);
    let replacedClaim: string | null = null;
    const failingStore = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step !== 'quarantine_claim_fsynced' || replacedClaim !== null) return;
        const claimName = (await fs.readdir(quarantinePath)).find((name) => name.startsWith('.cleanup-'));
        expect(claimName).toBeDefined();
        replacedClaim = path.join(quarantinePath, claimName!);
        await fs.rename(replacedClaim, displacedClaim);
        await fs.symlink(externalPath, replacedClaim, 'dir');
      },
    });

    await expectAsyncCode(failingStore.repair(authority), 'storage_error');

    expect(replacedClaim).not.toBeNull();
    expect((await fs.lstat(replacedClaim!)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(externalEntryPath)).toEqual(sentinel);
    expect(await fs.readFile(ownedPath, 'utf8')).toBe('owned quarantine entry');
    expect(await fs.readdir(displacedClaim)).toEqual([]);
  });

  it('refuses a catalog-temp claim parent replaced by an external symlink before rename', async () => {
    const authority = await makeAuthority();
    const seedingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    await seedingStore.create(authority, makeCreatePlan('catalog_temp_claim_parent', 1));
    const catalogPath = path.join(authority.projectDir, 'exports-v2.json');
    const tempPath = path.join(authority.projectDir, '.exports-v2.json-claim_parent.part');
    await fs.rename(catalogPath, tempPath);
    const quarantinePath = path.join(authority.projectDir, 'exports-quarantine');
    const externalPath = path.join(path.dirname(authority.projectDir), 'external-temp-claim');
    const externalEntryPath = path.join(externalPath, 'entry');
    const sentinel = Buffer.from('external temp claim sentinel');
    const scratchPath = path.join(path.dirname(authority.projectDir), 'temp-claim-scratch');
    const displacedClaim = path.join(scratchPath, 'displaced-claim');
    await fs.mkdir(externalPath);
    await fs.writeFile(externalEntryPath, sentinel);
    await fs.mkdir(scratchPath);
    let replacedClaim: string | null = null;
    const failingStore = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step !== 'quarantine_claim_fsynced' || replacedClaim !== null) return;
        const claimName = (await fs.readdir(quarantinePath)).find((name) => name.startsWith('nonce_'));
        expect(claimName).toBeDefined();
        replacedClaim = path.join(quarantinePath, claimName!);
        await fs.rename(replacedClaim, displacedClaim);
        await fs.symlink(externalPath, replacedClaim, 'dir');
      },
    });

    await expectAsyncCode(failingStore.repair(authority), 'storage_error');

    expect(replacedClaim).not.toBeNull();
    expect((await fs.lstat(replacedClaim!)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(externalEntryPath)).toEqual(sentinel);
    await expect(fs.access(tempPath)).resolves.toBeUndefined();
    expect(await fs.readdir(displacedClaim)).toEqual([]);
  });

  it('unlinks a quarantined symlink without following its external target', async () => {
    const authority = await makeAuthority();
    const quarantinePath = path.join(authority.projectDir, 'exports-quarantine');
    const externalPath = path.join(path.dirname(authority.projectDir), 'external-quarantine-target');
    const sentinelPath = path.join(externalPath, 'sentinel.bin');
    const sentinel = Buffer.from('external quarantine sentinel');
    await fs.mkdir(quarantinePath);
    await fs.mkdir(externalPath);
    await fs.writeFile(sentinelPath, sentinel);
    await fs.symlink(externalPath, path.join(quarantinePath, 'hostile-link'), 'dir');
    const store = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });

    await expect(store.repair(authority)).resolves.toEqual(createLogicalStudioExportCatalogV2(authority.project.id));

    expect(await fs.readFile(sentinelPath)).toEqual(sentinel);
    expect(await fs.readdir(quarantinePath)).toEqual([]);
  });

  it('retains an ambiguous recursive claim when a proved directory becomes an external symlink before reading', async () => {
    const authority = await makeAuthority();
    const quarantinePath = path.join(authority.projectDir, 'exports-quarantine');
    const quarantinedPath = path.join(quarantinePath, 'quarantined-tree');
    const nestedPath = path.join(quarantinedPath, 'nested');
    const externalPath = path.join(path.dirname(authority.projectDir), 'external-recursive-target');
    const sentinelPath = path.join(externalPath, 'sentinel.bin');
    const sentinel = Buffer.from('external recursive quarantine sentinel');
    await fs.mkdir(nestedPath, { recursive: true });
    await fs.writeFile(path.join(nestedPath, 'owned.bin'), 'owned quarantine bytes');
    await fs.mkdir(externalPath);
    await fs.writeFile(sentinelPath, sentinel);
    let openedDirectories = 0;
    let displacedPath: string | null = null;
    let replacementPath: string | null = null;
    const store = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step !== 'quarantine_directory_opened' || ++openedDirectories !== 2) return;
        const [claimName] = await fs.readdir(quarantinePath);
        expect(claimName).toMatch(/^\.cleanup-/);
        const claimPath = path.join(quarantinePath, claimName!);
        replacementPath = path.join(claimPath, 'entry', 'nested');
        displacedPath = path.join(claimPath, 'entry', 'displaced-nested');
        await fs.rename(replacementPath, displacedPath);
        await fs.symlink(externalPath, replacementPath, 'dir');
      },
    });

    await expectAsyncCode(store.repair(authority), 'storage_error');

    expect(displacedPath).not.toBeNull();
    expect(replacementPath).not.toBeNull();
    expect((await fs.lstat(replacementPath!)).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(replacementPath!)).toBe(externalPath);
    expect(await fs.readFile(path.join(displacedPath!, 'owned.bin'), 'utf8')).toBe('owned quarantine bytes');
    expect(await fs.readFile(sentinelPath)).toEqual(sentinel);
    expect(await fs.readdir(quarantinePath)).toHaveLength(1);
  });

  it('never commits or unlinks an exact-byte foreign replacement at the catalog temp hook', async () => {
    const authority = await makeAuthority();
    const seedingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const priorCatalog = await seedingStore.create(authority, makeCreatePlan('before_catalog_temp_swap', 1));
    const displacedPath = path.join(authority.projectDir, 'displaced-owned-catalog-temp.bin');
    let replacementPath: string | null = null;
    const failingStore = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step !== 'catalog_temp_fsynced') return;
        const candidates = (await fs.readdir(authority.projectDir)).filter(
          (entry) => entry.startsWith('.exports-v2.json-') && entry.endsWith('.part')
        );
        expect(candidates).toHaveLength(1);
        replacementPath = path.join(authority.projectDir, candidates[0]!);
        await fs.rename(replacementPath, displacedPath);
        await fs.copyFile(displacedPath, replacementPath);
      },
    });

    await expectAsyncCode(
      failingStore.create(authority, makeCreatePlan('catalog_temp_swap', priorCatalog.revision)),
      'storage_error'
    );

    expect(replacementPath).not.toBeNull();
    expect(await fs.readFile(replacementPath!)).toEqual(await fs.readFile(displacedPath));
    const displacedCatalog = JSON.parse(await fs.readFile(displacedPath, 'utf8')) as StudioExportCatalogV2;
    expect(displacedCatalog.artifacts.map(({ id }) => id)).toContain('artifact_catalog_temp_swap');
    const restartedStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    await expect(restartedStore.list(authority)).resolves.toEqual(priorCatalog);
    expect(await fs.readdir(path.join(authority.projectDir, 'exports'))).toEqual(['managed_before_catalog_temp_swap']);
  });

  it('never follows or commits a symlink replacement at the catalog temp hook', async () => {
    const authority = await makeAuthority();
    const seedingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const priorCatalog = await seedingStore.create(authority, makeCreatePlan('before_catalog_temp_symlink', 1));
    const displacedPath = path.join(authority.projectDir, 'displaced-symlink-target-catalog-temp.bin');
    let replacementPath: string | null = null;
    const failingStore = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step !== 'catalog_temp_fsynced') return;
        const candidates = (await fs.readdir(authority.projectDir)).filter(
          (entry) => entry.startsWith('.exports-v2.json-') && entry.endsWith('.part')
        );
        expect(candidates).toHaveLength(1);
        replacementPath = path.join(authority.projectDir, candidates[0]!);
        await fs.rename(replacementPath, displacedPath);
        await fs.symlink(displacedPath, replacementPath);
      },
    });

    await expectAsyncCode(
      failingStore.create(authority, makeCreatePlan('catalog_temp_symlink', priorCatalog.revision)),
      'storage_error'
    );

    expect(replacementPath).not.toBeNull();
    expect((await fs.lstat(replacementPath!)).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(replacementPath!)).toBe(displacedPath);
    const displacedCatalog = JSON.parse(await fs.readFile(displacedPath, 'utf8')) as StudioExportCatalogV2;
    expect(displacedCatalog.artifacts.map(({ id }) => id)).toContain('artifact_catalog_temp_symlink');
    await expect(failingStore.list(authority)).resolves.toEqual(priorCatalog);
    expect(await fs.readdir(path.join(authority.projectDir, 'exports'))).toEqual([
      'managed_before_catalog_temp_symlink',
    ]);
  });

  it.each([
    { seedIds: ['a', 'b', 'c', 'd', 'e'], nextId: 'z', replacedId: 'a', caseName: 'evicted prior tree' },
    { seedIds: ['b', 'c', 'd', 'e', 'f'], nextId: 'a', replacedId: 'a', caseName: 'self-evicted new tree' },
  ] as const)('rejects an exact-clone $caseName replacement at the catalog temp hook', async (fixture) => {
    const authority = await makeAuthority();
    const seedingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    let revision = 1;
    let priorCatalog!: StudioExportCatalogV2;
    for (const id of fixture.seedIds) {
      priorCatalog = await seedingStore.create(authority, makeCreatePlan(id, revision));
      revision = priorCatalog.revision;
    }
    const targetPath = path.join(authority.projectDir, 'exports', `managed_${fixture.replacedId}`);
    const scratchPath = path.join(
      path.dirname(authority.projectDir),
      `catalog-temp-${fixture.caseName.replaceAll(' ', '-')}`
    );
    const replacementPath = path.join(scratchPath, 'replacement');
    const displacedPath = path.join(scratchPath, 'displaced');
    await fs.mkdir(scratchPath);
    let replaced = false;
    const failingStore = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step !== 'catalog_temp_fsynced' || replaced) return;
        await fs.cp(targetPath, replacementPath, { recursive: true });
        await fs.rename(targetPath, displacedPath);
        await fs.rename(replacementPath, targetPath);
        replaced = true;
      },
    });

    await expectAsyncCode(failingStore.create(authority, makeCreatePlan(fixture.nextId, revision)), 'storage_error');

    expect(replaced).toBe(true);
    await expect(seedingStore.list(authority)).resolves.toEqual(priorCatalog);
    await expect(fs.access(targetPath)).resolves.toBeUndefined();
    await expect(fs.access(displacedPath)).resolves.toBeUndefined();
  });

  it('reproves project.json authority after the catalog temp hook and before physical commit validation', async () => {
    const authority = await makeAuthority();
    const projectFilePath = path.join(authority.projectDir, 'project.json');
    const displacedProjectPath = path.join(authority.projectDir, 'displaced-project.json');
    const originalBytes = Buffer.from('original project authority');
    const replacementBytes = Buffer.from('replacement project authority');
    await fs.writeFile(projectFilePath, originalBytes);
    const originalIdentity = await fs.lstat(projectFilePath);
    authority.assertCurrent = async () => {
      const current = await fs.lstat(projectFilePath);
      if (
        String(current.dev) !== String(originalIdentity.dev) ||
        String(current.ino) !== String(originalIdentity.ino) ||
        current.size !== originalIdentity.size
      ) {
        throw new Error('project authority replaced');
      }
    };
    let replaced = false;
    const failingStore = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step !== 'catalog_temp_fsynced') return;
        await fs.rename(projectFilePath, displacedProjectPath);
        await fs.writeFile(projectFilePath, replacementBytes);
        replaced = true;
      },
    });

    await expectAsyncCode(failingStore.create(authority, makeCreatePlan('project_authority_swap', 1)), 'storage_error');

    expect(replaced).toBe(true);
    expect(await fs.readFile(projectFilePath)).toEqual(replacementBytes);
    expect(await fs.readFile(displacedProjectPath)).toEqual(originalBytes);
    await expect(fs.access(path.join(authority.projectDir, 'exports-v2.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await fs.readdir(path.join(authority.projectDir, 'exports'))).toEqual([]);
  });

  it('revalidates prospective active bytes after the catalog temp hook and before commit', async () => {
    const authority = await makeAuthority();
    const seedingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const priorCatalog = await seedingStore.create(authority, makeCreatePlan('before_final_revalidation', 1));
    const catalogPath = path.join(authority.projectDir, 'exports-v2.json');
    const priorCatalogBytes = await fs.readFile(catalogPath);
    const mutatedBytes = Buffer.from('mutated after prospective validation');
    const failingStore = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step !== 'catalog_temp_fsynced') return;
        await fs.writeFile(
          path.join(authority.projectDir, 'exports', 'managed_after_final_revalidation', 'script.md'),
          mutatedBytes
        );
      },
    });

    await expectAsyncCode(
      failingStore.create(authority, makeCreatePlan('after_final_revalidation', priorCatalog.revision)),
      'storage_error'
    );

    expect(await fs.readFile(catalogPath)).toEqual(priorCatalogBytes);
    await expect(failingStore.list(authority)).resolves.toEqual(priorCatalog);
    expect(await fs.readdir(path.join(authority.projectDir, 'exports'))).toEqual(['managed_before_final_revalidation']);
    const quarantinePath = path.join(authority.projectDir, 'exports-quarantine');
    const quarantined = await fs.readdir(quarantinePath);
    let preservedMutation = false;
    for (const entry of quarantined) {
      for (const relativePath of ['script.md', path.join('entry', 'script.md')]) {
        try {
          if ((await fs.readFile(path.join(quarantinePath, entry, relativePath))).equals(mutatedBytes)) {
            preservedMutation = true;
          }
        } catch {
          // The catalog temp is retained in a separate private quarantine directory.
        }
      }
    }
    expect(preservedMutation).toBe(true);
  });

  it('repeats catalog CAS after physical proof and rejects an exact-clone late replacement', async () => {
    const authority = await makeAuthority();
    const seedingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const priorCatalog = await seedingStore.create(authority, makeCreatePlan('before_late_catalog_cas', 1));
    const catalogPath = path.join(authority.projectDir, 'exports-v2.json');
    const scratchPath = path.join(path.dirname(authority.projectDir), 'late-catalog-cas');
    const displacedPath = path.join(scratchPath, 'displaced.json');
    const replacementPath = path.join(scratchPath, 'replacement.json');
    await fs.mkdir(scratchPath);
    let currentChecks = 0;
    let replaced = false;
    authority.assertCurrent = async () => {
      currentChecks += 1;
      if (currentChecks !== 7) return;
      await fs.copyFile(catalogPath, replacementPath);
      await fs.rename(catalogPath, displacedPath);
      await fs.rename(replacementPath, catalogPath);
      replaced = true;
    };
    const failingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });

    await expectAsyncCode(
      failingStore.create(authority, makeCreatePlan('rejected_late_catalog_cas', priorCatalog.revision)),
      'stale_catalog_revision'
    );

    expect(currentChecks).toBe(7);
    expect(replaced).toBe(true);
    expect(await fs.readFile(catalogPath)).toEqual(await fs.readFile(displacedPath));
    authority.assertCurrent = undefined;
    await expect(seedingStore.list(authority)).resolves.toEqual(priorCatalog);
    expect(await fs.readdir(path.join(authority.projectDir, 'exports'))).toEqual(['managed_before_late_catalog_cas']);
  });

  it('reproves the exact catalog temp after the final project assertion before rename', async () => {
    const authority = await makeAuthority();
    const seedingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const priorCatalog = await seedingStore.create(authority, makeCreatePlan('before_late_temp_swap', 1));
    const catalogPath = path.join(authority.projectDir, 'exports-v2.json');
    const priorCatalogBytes = await fs.readFile(catalogPath);
    const displacedPath = path.join(authority.projectDir, 'displaced-late-catalog-temp.bin');
    let replacementPath: string | null = null;
    let currentChecks = 0;
    authority.assertCurrent = async () => {
      currentChecks += 1;
      if (currentChecks !== 7) return;
      const candidates = (await fs.readdir(authority.projectDir)).filter(
        (entry) => entry.startsWith('.exports-v2.json-') && entry.endsWith('.part')
      );
      expect(candidates).toHaveLength(1);
      replacementPath = path.join(authority.projectDir, candidates[0]!);
      await fs.rename(replacementPath, displacedPath);
      await fs.copyFile(displacedPath, replacementPath);
    };
    const failingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });

    await expectAsyncCode(
      failingStore.create(authority, makeCreatePlan('rejected_late_temp_swap', priorCatalog.revision)),
      'storage_error'
    );

    expect(currentChecks).toBe(7);
    expect(replacementPath).not.toBeNull();
    expect(await fs.readFile(catalogPath)).toEqual(priorCatalogBytes);
    expect(await fs.readFile(replacementPath!)).toEqual(await fs.readFile(displacedPath));
    authority.assertCurrent = undefined;
    await expect(seedingStore.list(authority)).resolves.toEqual(priorCatalog);
    expect(await fs.readdir(path.join(authority.projectDir, 'exports'))).toEqual(['managed_before_late_temp_swap']);
  });

  it('rejects but preserves a committed catalog replaced during the post-rename directory sync', async () => {
    const authority = await makeAuthority();
    const seedingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const priorCatalog = await seedingStore.create(authority, makeCreatePlan('before_catalog_sync_swap', 1));
    const catalogPath = path.join(authority.projectDir, 'exports-v2.json');
    const scratchPath = path.join(path.dirname(authority.projectDir), 'catalog-sync-swap');
    const displacedPath = path.join(scratchPath, 'displaced.json');
    const replacementPath = path.join(scratchPath, 'replacement.json');
    await fs.mkdir(scratchPath);
    let directorySyncs = 0;
    let replaced = false;
    const failingStore = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      catalogDirectorySync: async (directoryPath) => {
        directorySyncs += 1;
        const handle = await fs.open(directoryPath, 'r');
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (directorySyncs !== 2) return;
        await fs.copyFile(catalogPath, replacementPath);
        await fs.rename(catalogPath, displacedPath);
        await fs.rename(replacementPath, catalogPath);
        replaced = true;
      },
    });

    await expectAsyncCode(
      failingStore.create(authority, makeCreatePlan('after_catalog_sync_swap', priorCatalog.revision)),
      'storage_error'
    );

    expect(directorySyncs).toBe(2);
    expect(replaced).toBe(true);
    expect(await fs.readFile(catalogPath)).toEqual(await fs.readFile(displacedPath));
    const committed = await seedingStore.list(authority);
    expect(committed.artifacts.map(({ id }) => id)).toEqual([
      'artifact_after_catalog_sync_swap',
      'artifact_before_catalog_sync_swap',
    ]);
    expect(await fs.readdir(path.join(authority.projectDir, 'exports'))).toEqual([
      'managed_after_catalog_sync_swap',
      'managed_before_catalog_sync_swap',
    ]);
  });

  it('does not report create success when a foreign active child appears at catalog commit', async () => {
    const authority = await makeAuthority();
    const seedingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const priorCatalog = await seedingStore.create(authority, makeCreatePlan('before_committed_child', 1));
    const foreignPath = path.join(authority.projectDir, 'exports', 'foreign-committed-child');
    const sentinelPath = path.join(foreignPath, 'sentinel.bin');
    const sentinel = Buffer.from('foreign active child at committed boundary');
    let inserted = false;
    const failingStore = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: async (step) => {
        if (step !== 'catalog_committed' || inserted) return;
        await fs.mkdir(foreignPath);
        await fs.writeFile(sentinelPath, sentinel);
        inserted = true;
      },
    });

    await expectAsyncCode(
      failingStore.create(authority, makeCreatePlan('after_committed_child', priorCatalog.revision)),
      'storage_error'
    );

    expect(inserted).toBe(true);
    expect(await fs.readFile(sentinelPath)).toEqual(sentinel);
    const committed = await seedingStore.list(authority);
    expect(committed.artifacts.map(({ id }) => id)).toEqual([
      'artifact_after_committed_child',
      'artifact_before_committed_child',
    ]);
  });

  it('preserves an active artifact across an ambiguous catalog post-rename directory-sync failure', async () => {
    const authority = await makeAuthority();
    const seedingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const priorCatalog = await seedingStore.create(authority, makeCreatePlan('before_sync_failure', 1));
    const catalogPath = path.join(authority.projectDir, 'exports-v2.json');
    const priorCatalogBytes = await fs.readFile(catalogPath);
    let catalogDirectorySyncs = 0;
    const failingStore = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      catalogDirectorySync: async (directoryPath) => {
        catalogDirectorySyncs += 1;
        if (catalogDirectorySyncs === 2) {
          const visibleCatalog = JSON.parse(await fs.readFile(catalogPath, 'utf8')) as StudioExportCatalogV2;
          expect(visibleCatalog.artifacts.map(({ id }) => id)).toEqual([
            'artifact_after_sync_failure',
            'artifact_before_sync_failure',
          ]);
          throw new Error('injected project-directory sync failure after catalog rename');
        }
        const handle = await fs.open(directoryPath, 'r');
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      },
    });

    await expectAsyncCode(
      failingStore.create(authority, makeCreatePlan('after_sync_failure', priorCatalog.revision)),
      'storage_error'
    );
    expect(catalogDirectorySyncs).toBe(2);
    const newCatalogRestart = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const renamedCatalog = await newCatalogRestart.list(authority);
    expect(renamedCatalog.revision).toBe(priorCatalog.revision + 1);
    expect(renamedCatalog.artifacts.map(({ id }) => id)).toEqual([
      'artifact_after_sync_failure',
      'artifact_before_sync_failure',
    ]);
    expect(await fs.readdir(path.join(authority.projectDir, 'exports'))).toEqual([
      'managed_after_sync_failure',
      'managed_before_sync_failure',
    ]);

    await fs.writeFile(catalogPath, priorCatalogBytes);
    const oldCatalogRestart = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    await expect(oldCatalogRestart.repair(authority)).resolves.toEqual(priorCatalog);
    expect(await fs.readdir(path.join(authority.projectDir, 'exports'))).toEqual(['managed_before_sync_failure']);
    expect(await fs.readdir(path.join(authority.projectDir, 'exports-quarantine'))).toHaveLength(1);
  });

  it('recovers both sides of catalog commit fault boundaries without an orphan active artifact', async () => {
    const authority = await makeAuthority();
    const seedingStore = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    const stagedCatalog = await seedingStore.create(authority, makeCreatePlan('before', 1));
    const catalogPath = path.join(authority.projectDir, 'exports-v2.json');
    const postFsyncTempPath = path.join(authority.projectDir, '.exports-v2.json-crash_nonce.part');
    await fs.rename(catalogPath, postFsyncTempPath);
    const tempHandle = await fs.open(postFsyncTempPath, 'r');
    try {
      await tempHandle.sync();
    } finally {
      await tempHandle.close();
    }
    const projectDirectoryHandle = await fs.open(authority.projectDir, 'r');
    try {
      await projectDirectoryHandle.sync();
    } finally {
      await projectDirectoryHandle.close();
    }
    expect(JSON.parse(await fs.readFile(postFsyncTempPath, 'utf8'))).toEqual(stagedCatalog);

    const unrelatedPath = path.join(authority.projectDir, 'unrelated-root.bin');
    const unrelatedBytes = Buffer.from('unrelated-root-bytes');
    await fs.writeFile(unrelatedPath, unrelatedBytes);
    const unrelatedBefore = await fs.lstat(unrelatedPath);
    const hostileTempPath = path.join(authority.projectDir, '.exports-v2.json-hostile_nonce.part');
    await fs.link(unrelatedPath, hostileTempPath);
    const lookalikes = new Map<string, Buffer>([
      ['.exports-v2.json-invalid.nonce.part', Buffer.from('invalid-dot-nonce')],
      ['.exports-v2.json-safe_nonce.tmp', Buffer.from('wrong-suffix')],
      ['exports-v2.json-safe_nonce.part', Buffer.from('missing-prefix')],
    ]);
    for (const [name, bytes] of lookalikes) await fs.writeFile(path.join(authority.projectDir, name), bytes);

    await expect(fs.access(path.join(authority.projectDir, 'exports-v2.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const restarted = createStudioExportCatalogStoreV2({ createNonce: nonceSequence() });
    await expect(restarted.repair(authority)).resolves.toEqual({
      schemaVersion: 5,
      projectId: 'project_1',
      revision: 1,
      artifacts: [],
    });
    await expect(fs.access(postFsyncTempPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(hostileTempPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(path.join(authority.projectDir, 'exports'))).toEqual([]);
    expect(await fs.readdir(path.join(authority.projectDir, 'exports-quarantine'))).toHaveLength(2);
    expect(await fs.readFile(unrelatedPath)).toEqual(unrelatedBytes);
    const unrelatedAfter = await fs.lstat(unrelatedPath);
    expect({ dev: unrelatedAfter.dev, ino: unrelatedAfter.ino, size: unrelatedAfter.size }).toEqual({
      dev: unrelatedBefore.dev,
      ino: unrelatedBefore.ino,
      size: unrelatedBefore.size,
    });
    for (const [name, bytes] of lookalikes) {
      expect(await fs.readFile(path.join(authority.projectDir, name))).toEqual(bytes);
    }
    await restarted.repair(authority);
    expect(await fs.readdir(path.join(authority.projectDir, 'exports-quarantine'))).toEqual([]);
    expect(await fs.readFile(unrelatedPath)).toEqual(unrelatedBytes);
    for (const [name, bytes] of lookalikes) {
      expect(await fs.readFile(path.join(authority.projectDir, name))).toEqual(bytes);
    }

    const afterCommit = createStudioExportCatalogStoreV2({
      createNonce: nonceSequence(),
      onStep: (step) => {
        if (step === 'catalog_committed') throw new Error('simulated crash after catalog rename');
      },
    });
    await expectAsyncCode(afterCommit.create(authority, makeCreatePlan('after', 1)), 'storage_error');
    const recovered = await restarted.list(authority);
    expect(recovered.revision).toBe(2);
    expect(recovered.artifacts.map(({ id }) => id)).toEqual(['artifact_after']);
  });
});
