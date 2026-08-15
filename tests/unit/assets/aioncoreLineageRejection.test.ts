import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const {
  verifyBundledAioncoreResources,
} = require('../../../packages/shared-scripts/src/verify-bundled-aioncore-resources');
const { prepareAioncore } = require('../../../packages/shared-scripts/src/prepare-aioncore');

type LineageEntry = { version: number; description: string; filename: string; checksum: string };
type Lineage = {
  schemaVersion: number;
  minimumSupportedVersion: number;
  latestVersion: number;
  entryCount: number;
  fingerprint: string;
  entries: LineageEntry[];
};

// Separate fixture copied from the pinned AionCore candidate contract.
const INDEPENDENT_ACCEPTED_LINEAGE: Lineage = require('../../fixtures/release/aioncore-v0.1.55-migration-lineage.json');

const COMPUTED_REPLACEMENT_CHECKSUM = createHash('sha384')
  .update('-- T1.3a deliberately incompatible migration checksum\n', 'utf8')
  .digest('hex');
const COMPUTED_EXTRA_ENTRY_CHECKSUM = createHash('sha384')
  .update('-- T1.3a deliberately extra migration 28\n', 'utf8')
  .digest('hex');

function cloneAcceptedLineage(): Lineage {
  return structuredClone(INDEPENDENT_ACCEPTED_LINEAGE);
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeBundleLineage(runtimeRoot: string, lineage: Lineage) {
  writeJson(join(runtimeRoot, 'migration-lineage.json'), lineage);
  writeJson(join(runtimeRoot, 'manifest.json'), {
    platform: 'darwin',
    arch: 'arm64',
    migrationLineage: { ...lineage, file: 'migration-lineage.json' },
  });
}

const LINEAGE_MUTATIONS: Array<[string, (lineage: Lineage) => void]> = [
  ['a changed checksum', (lineage) => (lineage.entries[19].checksum = COMPUTED_REPLACEMENT_CHECKSUM)],
  ['a missing entry', (lineage) => lineage.entries.splice(19, 1)],
  [
    'an extra entry',
    (lineage) =>
      lineage.entries.push({
        version: 29,
        description: 'deliberately extra migration',
        filename: '029_deliberately_extra_migration.sql',
        checksum: COMPUTED_EXTRA_ENTRY_CHECKSUM,
      }),
  ],
  [
    'a reordered list',
    (lineage) => ([lineage.entries[19], lineage.entries[20]] = [lineage.entries[20], lineage.entries[19]]),
  ],
  ['a changed latest version', (lineage) => (lineage.latestVersion = 29)],
  ['a changed minimum supported version', (lineage) => (lineage.minimumSupportedVersion = 20)],
];

describe('AionCore packaging lineage rejection', () => {
  let temporaryRoot: string;
  let resourcesDir: string;
  let runtimeRoot: string;
  let sentinelPath: string;
  const sentinelBytes = Buffer.from([0x00, 0x13, 0x40, 0xff, 0x0a, 0x7f]);

  beforeEach(() => {
    temporaryRoot = mkdtempSync(join(tmpdir(), 'aionui-real-lineage-rejection-'));
    resourcesDir = join(temporaryRoot, 'resources');
    runtimeRoot = join(resourcesDir, 'bundled-aioncore', 'darwin-arm64');
    sentinelPath = join(runtimeRoot, 'preserve-me.bin');
    mkdirSync(join(runtimeRoot, 'managed-resources'), { recursive: true });
    writeFileSync(join(runtimeRoot, 'aioncore'), 'test binary');
    writeFileSync(sentinelPath, sentinelBytes);
    writeBundleLineage(runtimeRoot, cloneAcceptedLineage());
  });

  afterEach(() => {
    rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it('accepts the independently hand-written lineage at both comparison boundaries', () => {
    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'darwin',
      targetArch: 'arm64',
    });

    expect(result.failures.filter(({ component }: { component: string }) => component === 'migration-lineage')).toEqual(
      []
    );
  });

  it.each(LINEAGE_MUTATIONS)('rejects %s in both the bundle document and manifest', (_name, mutate) => {
    const incompatibleLineage = cloneAcceptedLineage();
    mutate(incompatibleLineage);
    writeBundleLineage(runtimeRoot, incompatibleLineage);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'darwin',
      targetArch: 'arm64',
    });

    expect(result.failures).toContainEqual({
      component: 'migration-lineage',
      reason: 'manifest_mismatch',
      path: 'bundled-aioncore/darwin-arm64/manifest.json',
    });
    expect(result.failures).toContainEqual({
      component: 'migration-lineage',
      reason: 'lineage_mismatch',
      path: 'bundled-aioncore/darwin-arm64/migration-lineage.json',
    });
  });

  it('preserves unrelated bundle bytes after a real checksum rejection', () => {
    const incompatibleLineage = cloneAcceptedLineage();
    incompatibleLineage.entries[19].checksum = COMPUTED_REPLACEMENT_CHECKSUM;
    writeBundleLineage(runtimeRoot, incompatibleLineage);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'darwin',
      targetArch: 'arm64',
    });

    expect(result.failures).toContainEqual(
      expect.objectContaining({ component: 'migration-lineage', reason: 'lineage_mismatch' })
    );
    expect(readFileSync(sentinelPath)).toEqual(sentinelBytes);
  });

  it('fails closed when the bundle has no migration-lineage.json evidence', () => {
    rmSync(join(runtimeRoot, 'migration-lineage.json'));

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'darwin',
      targetArch: 'arm64',
    });

    expect(result.failures).toContainEqual({
      component: 'migration-lineage',
      reason: 'missing_file',
      path: 'bundled-aioncore/darwin-arm64/migration-lineage.json',
    });
  });
});

describe('prepare-aioncore accepted-lineage boundary', () => {
  let temporaryRoot: string;
  let localBundle: string;
  let projectRoot: string;
  let sentinelPath: string;
  let previousLocalBundle: string | undefined;
  const sentinelBytes = Buffer.from('source bundle must survive rejection\n', 'utf8');

  beforeEach(() => {
    temporaryRoot = mkdtempSync(join(tmpdir(), 'aionui-prepare-lineage-rejection-'));
    localBundle = join(temporaryRoot, 'local-bundle');
    projectRoot = join(temporaryRoot, 'project');
    sentinelPath = join(localBundle, 'preserve-me.bin');
    mkdirSync(join(localBundle, 'managed-resources'), { recursive: true });
    writeFileSync(join(localBundle, 'aioncore'), 'test binary');
    writeFileSync(sentinelPath, sentinelBytes);
    previousLocalBundle = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = localBundle;
  });

  afterEach(() => {
    if (previousLocalBundle === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    else process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previousLocalBundle;
    rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it('rejects a real local-bundle checksum mismatch as a typed integrity failure and preserves its bytes', () => {
    const incompatibleLineage = cloneAcceptedLineage();
    incompatibleLineage.entries[19].checksum = COMPUTED_REPLACEMENT_CHECKSUM;
    writeJson(join(localBundle, 'migration-lineage.json'), incompatibleLineage);

    let failure: (Error & { isAioncoreIntegrityError?: boolean }) | undefined;
    try {
      prepareAioncore({ projectRoot, platform: 'darwin', arch: 'arm64', version: 'v0.1.62' });
    } catch (error) {
      if (error instanceof Error) failure = error;
    }

    expect(failure).toMatchObject({ isAioncoreIntegrityError: true });
    expect(failure?.message).toMatch(/migration lineage does not match the accepted WePrompt lineage/);
    expect(readFileSync(sentinelPath)).toEqual(sentinelBytes);
  });

  it('fails closed when a real local bundle has no migration-lineage.json evidence', () => {
    let failure: (Error & { isAioncoreIntegrityError?: boolean }) | undefined;
    try {
      prepareAioncore({ projectRoot, platform: 'darwin', arch: 'arm64', version: 'v0.1.62' });
    } catch (error) {
      if (error instanceof Error) failure = error;
    }

    expect(failure).toMatchObject({ isAioncoreIntegrityError: true });
    expect(failure?.message).toMatch(/missing a valid migration-lineage\.json document/);
  });
});
