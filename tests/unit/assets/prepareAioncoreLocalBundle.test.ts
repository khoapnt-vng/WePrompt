import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

const { acceptedMigrationLineage } = require('../../../packages/shared-scripts/src/verify-bundled-aioncore-resources');
const {
  ACCEPTED_AIONCORE_SOURCE_COMMIT,
  getDefaultReleaseBundleContract,
  prepareAioncore,
} = require('../../../packages/shared-scripts/src/prepare-aioncore');
const {
  AIONCORE_RELEASE_REPOSITORY,
  expectedReleaseTarget,
  verifyAioncoreReleaseBundle,
} = require('../../../packages/shared-scripts/src/aioncoreReleaseBundle');

const RELEASE_FIXTURE_VERSION = '0.1.51';
const STRICT_FIXTURE_VERSION = '0.1.55';
const STRICT_FIXTURE_SOURCE_COMMIT = '1111111111111111111111111111111111111111';
const STRICT_FIXTURE_REPOSITORY = 'khoapnt-vng/aioncore';
const STRICT_TARGET_FIXTURES = Object.freeze([
  {
    platform: 'darwin',
    arch: 'arm64',
    runtimeKey: 'darwin-arm64',
    target: 'aarch64-apple-darwin',
    officeCliName: 'officecli',
  },
  {
    platform: 'win32',
    arch: 'x64',
    runtimeKey: 'win32-x64',
    target: 'x86_64-pc-windows-msvc',
    officeCliName: 'officecli.exe',
  },
] as const);

function writeFixtureFile(filePath: string, contents = '') {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function createCompleteLocalBundle(root: string, platform: 'darwin' | 'win32', arch: 'arm64' | 'x64') {
  const runtimeKey = `${platform}-${arch}`;
  const binaryName = platform === 'win32' ? 'aioncore.exe' : 'aioncore';
  const executableSuffix = platform === 'win32' ? '.exe' : '';
  const targetTriple =
    platform === 'darwin'
      ? arch === 'arm64'
        ? 'aarch64-apple-darwin'
        : 'x86_64-apple-darwin'
      : arch === 'arm64'
        ? 'aarch64-pc-windows-msvc'
        : 'x86_64-pc-windows-msvc';
  const managedRoot = join(root, 'managed-resources');
  const nodeRoot = `node/node-v24.11.0-${runtimeKey}`;
  const nodeExecutable = platform === 'win32' ? 'node.exe' : 'bin/node';
  const claudeRoot = `cli/claude/2.1.215/${runtimeKey}`;
  const codexRoot = `cli/codex/0.144.6/${runtimeKey}`;

  writeFixtureFile(join(root, binaryName));
  writeFixtureFile(join(root, 'migration-lineage.json'), `${JSON.stringify(acceptedMigrationLineage, null, 2)}\n`);
  writeFixtureFile(join(managedRoot, nodeRoot, nodeExecutable));
  writeFixtureFile(join(managedRoot, claudeRoot, `claude${executableSuffix}`));
  writeFixtureFile(join(managedRoot, codexRoot, 'vendor', targetTriple, 'bin', `codex${executableSuffix}`));
  mkdirSync(join(managedRoot, codexRoot, 'vendor', targetTriple, 'codex-resources'), { recursive: true });
  writeFixtureFile(
    join(managedRoot, 'manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 2,
        runtimeKey,
        node: { version: '24.11.0', root: nodeRoot, executable: nodeExecutable },
        clis: [
          {
            name: 'claude',
            version: '2.1.215',
            root: claudeRoot,
            platformDirectory: runtimeKey,
            executable: `claude${executableSuffix}`,
            requiredFiles: [],
            requiredDirectories: [],
          },
          {
            name: 'codex',
            version: '0.144.6',
            root: codexRoot,
            platformDirectory: runtimeKey,
            executable: `vendor/${targetTriple}/bin/codex${executableSuffix}`,
            requiredFiles: [],
            requiredDirectories: [`vendor/${targetTriple}/codex-resources`],
          },
        ],
      },
      null,
      2
    )}\n`
  );
}

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function listFixtureFiles(root: string, directory = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFixtureFiles(root, fullPath));
    } else if (entry.isFile()) {
      files.push(relative(root, fullPath).split('\\').join('/'));
    }
  }
  return files.toSorted();
}

function sealReleaseBundle(
  root: string,
  platform: 'darwin' | 'win32',
  arch: 'arm64' | 'x64',
  provenance: Partial<{
    repository: string;
    version: string;
    sourceCommit: string;
    target: string;
  }> = {}
) {
  const officeCliName = platform === 'win32' ? 'officecli.exe' : 'officecli';
  writeFixtureFile(join(root, 'managed-resources', 'office', officeCliName), 'verified-officecli\n');
  const payloadPaths = listFixtureFiles(root);
  const { entries: _entries, ...migrationLineage } = acceptedMigrationLineage;
  const manifest = {
    schemaVersion: 1,
    repository: provenance.repository ?? AIONCORE_RELEASE_REPOSITORY,
    version: provenance.version ?? RELEASE_FIXTURE_VERSION,
    sourceCommit: provenance.sourceCommit ?? ACCEPTED_AIONCORE_SOURCE_COMMIT,
    target: provenance.target ?? expectedReleaseTarget(platform, arch),
    builtAt: '2026-09-01T12:00:00Z',
    migrationLineage,
    files: payloadPaths.map((relativePath) => ({
      path: relativePath,
      sha256: sha256(join(root, relativePath)),
      size: lstatSync(join(root, relativePath)).size,
    })),
  };
  writeFixtureFile(join(root, 'bundle-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const checksumPaths = [...payloadPaths, 'bundle-manifest.json'].toSorted();
  writeFixtureFile(
    join(root, 'SHA256SUMS'),
    `${checksumPaths.map((relativePath) => `${sha256(join(root, relativePath))}  ${relativePath}`).join('\n')}\n`
  );
  return manifest;
}

function strictFixtureContract() {
  return {
    repository: STRICT_FIXTURE_REPOSITORY,
    exactVersion: STRICT_FIXTURE_VERSION,
    expectedSourceCommit: STRICT_FIXTURE_SOURCE_COMMIT,
    expectedLineage: acceptedMigrationLineage,
    allowedRuntimeKeys: ['darwin-arm64', 'win32-x64'],
    requireCompleteBundle: true,
  };
}

function legacyFixtureContract(allowedRuntimeKeys: string[]) {
  return {
    repository: AIONCORE_RELEASE_REPOSITORY,
    expectedSourceCommit: ACCEPTED_AIONCORE_SOURCE_COMMIT,
    expectedLineage: acceptedMigrationLineage,
    allowedRuntimeKeys,
    requireCompleteBundle: false,
  };
}

function verifyReleaseFixture(
  root: string,
  overrides: Partial<{
    platform: 'darwin' | 'win32';
    arch: 'arm64' | 'x64';
    version: string;
    sourceCommit: string;
    expectedLineage: Record<string, unknown>;
    allowedRuntimeKeys: string[];
  }> = {}
) {
  return verifyAioncoreReleaseBundle({
    bundleDir: root,
    platform: overrides.platform ?? 'darwin',
    arch: overrides.arch ?? 'arm64',
    version: overrides.version ?? RELEASE_FIXTURE_VERSION,
    sourceCommit: overrides.sourceCommit ?? ACCEPTED_AIONCORE_SOURCE_COMMIT,
    repository: AIONCORE_RELEASE_REPOSITORY,
    expectedLineage: overrides.expectedLineage ?? acceptedMigrationLineage,
    allowedRuntimeKeys: overrides.allowedRuntimeKeys ?? ['darwin-arm64'],
  });
}

function updateReleaseManifest(root: string, mutate: (manifest: Record<string, unknown>) => void) {
  const manifestPath = join(root, 'bundle-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  mutate(manifest);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

describe('prepare-aioncore local bundle input', () => {
  it.each(STRICT_TARGET_FIXTURES)(
    'preserves the frozen strict $runtimeKey release bundle instead of regenerating managed resources',
    ({ platform, arch, runtimeKey, target, officeCliName }) => {
      const tmp = mkdtempSync(join(tmpdir(), 'aionui-complete-release-bundle-'));
      const projectRoot = join(tmp, 'project');
      const localBundle = join(tmp, 'bundle');
      createCompleteLocalBundle(localBundle, platform, arch);
      sealReleaseBundle(localBundle, platform, arch, {
        repository: STRICT_FIXTURE_REPOSITORY,
        version: STRICT_FIXTURE_VERSION,
        sourceCommit: STRICT_FIXTURE_SOURCE_COMMIT,
        target,
      });
      const expectedManifest = readFileSync(join(localBundle, 'bundle-manifest.json'));
      const expectedChecksums = readFileSync(join(localBundle, 'SHA256SUMS'));
      const previous = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
      process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = localBundle;

      try {
        prepareAioncore({
          projectRoot,
          platform,
          arch,
          version: `v${STRICT_FIXTURE_VERSION}`,
          releaseBundleContract: strictFixtureContract(),
        });
        const preparedRoot = join(projectRoot, 'resources', 'bundled-aioncore', runtimeKey);

        expect({
          manifest: readFileSync(join(preparedRoot, 'bundle-manifest.json')),
          checksums: readFileSync(join(preparedRoot, 'SHA256SUMS')),
          officeCli: readFileSync(join(preparedRoot, 'managed-resources', 'office', officeCliName), 'utf8'),
        }).toEqual({
          manifest: expectedManifest,
          checksums: expectedChecksums,
          officeCli: 'verified-officecli\n',
        });
      } finally {
        if (previous === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
        else process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previous;
        rmSync(tmp, { recursive: true, force: true });
      }
    }
  );

  it('fails closed instead of downgrading a bundle with partial release metadata to the legacy path', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-partial-release-bundle-'));
    const projectRoot = join(tmp, 'project');
    const localBundle = join(tmp, 'bundle');
    const sourceMarker = join(tmp, 'source-executed');
    const fallbackMarker = join(tmp, 'fallback-executed');
    const fallbackBinary = join(tmp, 'fallback-aioncore');
    const fallbackLineage = join(tmp, 'fallback-lineage.json');
    createCompleteLocalBundle(localBundle, 'darwin', 'arm64');
    writeFileSync(join(localBundle, 'aioncore'), `#!/bin/sh\ntouch '${sourceMarker}'\n`);
    chmodSync(join(localBundle, 'aioncore'), 0o755);
    writeFixtureFile(join(localBundle, 'bundle-manifest.json'), '{}\n');
    writeFixtureFile(fallbackBinary, `#!/bin/sh\ntouch '${fallbackMarker}'\n`);
    chmodSync(fallbackBinary, 0o755);
    writeFixtureFile(fallbackLineage, `${JSON.stringify(acceptedMigrationLineage)}\n`);
    const previousBundle = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    const previousBinary = process.env.AIONUI_BACKEND_LOCAL_BINARY;
    const previousLineage = process.env.AIONUI_BACKEND_LOCAL_LINEAGE;
    process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = localBundle;
    process.env.AIONUI_BACKEND_LOCAL_BINARY = fallbackBinary;
    process.env.AIONUI_BACKEND_LOCAL_LINEAGE = fallbackLineage;
    try {
      expect(() =>
        prepareAioncore({
          projectRoot,
          platform: 'darwin',
          arch: 'arm64',
          version: STRICT_FIXTURE_VERSION,
          releaseBundleContract: strictFixtureContract(),
        })
      ).toThrow(/incomplete release metadata/);
      expect({ sourceExecuted: existsSync(sourceMarker), fallbackExecuted: existsSync(fallbackMarker) }).toEqual({
        sourceExecuted: false,
        fallbackExecuted: false,
      });
    } finally {
      if (previousBundle === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
      else process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previousBundle;
      if (previousBinary === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BINARY;
      else process.env.AIONUI_BACKEND_LOCAL_BINARY = previousBinary;
      if (previousLineage === undefined) delete process.env.AIONUI_BACKEND_LOCAL_LINEAGE;
      else process.env.AIONUI_BACKEND_LOCAL_LINEAGE = previousLineage;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not execute, regenerate, or fall back when strict bundle metadata was stripped', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-stripped-release-bundle-'));
    const projectRoot = join(tmp, 'project');
    const localBundle = join(tmp, 'bundle');
    const sourceMarker = join(tmp, 'source-executed');
    const fallbackMarker = join(tmp, 'fallback-executed');
    const fallbackBinary = join(tmp, 'fallback-aioncore');
    const fallbackLineage = join(tmp, 'fallback-lineage.json');
    createCompleteLocalBundle(localBundle, 'darwin', 'arm64');
    writeFileSync(join(localBundle, 'aioncore'), `#!/bin/sh\ntouch '${sourceMarker}'\n`);
    chmodSync(join(localBundle, 'aioncore'), 0o755);
    writeFixtureFile(fallbackBinary, `#!/bin/sh\ntouch '${fallbackMarker}'\n`);
    chmodSync(fallbackBinary, 0o755);
    writeFixtureFile(fallbackLineage, `${JSON.stringify(acceptedMigrationLineage)}\n`);
    const previousBundle = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    const previousBinary = process.env.AIONUI_BACKEND_LOCAL_BINARY;
    const previousLineage = process.env.AIONUI_BACKEND_LOCAL_LINEAGE;
    process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = localBundle;
    process.env.AIONUI_BACKEND_LOCAL_BINARY = fallbackBinary;
    process.env.AIONUI_BACKEND_LOCAL_LINEAGE = fallbackLineage;

    try {
      expect(() =>
        prepareAioncore({
          projectRoot,
          platform: 'darwin',
          arch: 'arm64',
          version: STRICT_FIXTURE_VERSION,
          releaseBundleContract: strictFixtureContract(),
        })
      ).toThrow(/missing bundle-manifest\.json and SHA256SUMS/);
      expect({ sourceExecuted: existsSync(sourceMarker), fallbackExecuted: existsSync(fallbackMarker) }).toEqual({
        sourceExecuted: false,
        fallbackExecuted: false,
      });
    } finally {
      if (previousBundle === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
      else process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previousBundle;
      if (previousBinary === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BINARY;
      else process.env.AIONUI_BACKEND_LOCAL_BINARY = previousBinary;
      if (previousLineage === undefined) delete process.env.AIONUI_BACKEND_LOCAL_LINEAGE;
      else process.env.AIONUI_BACKEND_LOCAL_LINEAGE = previousLineage;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects strict release metadata nested below the selected bundle root', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-nested-release-bundle-'));
    const localBundle = join(tmp, 'bundle');
    const nestedBundle = join(localBundle, 'nested');
    createCompleteLocalBundle(nestedBundle, 'darwin', 'arm64');
    sealReleaseBundle(nestedBundle, 'darwin', 'arm64', {
      repository: STRICT_FIXTURE_REPOSITORY,
      version: STRICT_FIXTURE_VERSION,
      sourceCommit: STRICT_FIXTURE_SOURCE_COMMIT,
      target: 'aarch64-apple-darwin',
    });
    const previous = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = localBundle;
    try {
      expect(() =>
        prepareAioncore({
          projectRoot: join(tmp, 'project'),
          platform: 'darwin',
          arch: 'arm64',
          version: STRICT_FIXTURE_VERSION,
          releaseBundleContract: strictFixtureContract(),
        })
      ).toThrow(/missing bundle-manifest\.json and SHA256SUMS/);
    } finally {
      if (previous === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
      else process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previous;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it.each([
    ['latest', strictFixtureContract(), /requested version must be an exact version/],
    ['0.1.54', strictFixtureContract(), /does not match bundle contract 0\.1\.55/],
    [
      STRICT_FIXTURE_VERSION,
      { ...strictFixtureContract(), expectedSourceCommit: 'not-a-sha' },
      /no exact expected source commit/,
    ],
    [STRICT_FIXTURE_VERSION, { ...strictFixtureContract(), repository: 'untrusted/aioncore' }, /untrusted repository/],
    [
      STRICT_FIXTURE_VERSION,
      { ...strictFixtureContract(), allowedRuntimeKeys: ['darwin-arm65', 'win32-x64'] },
      /invalid runtime target/,
    ],
    [
      STRICT_FIXTURE_VERSION,
      { ...strictFixtureContract(), exactVersion: undefined },
      /strict AionCore release bundle contract requires exactVersion/,
    ],
  ])(
    'rejects invalid strict contract/version %s before source selection',
    (version, releaseBundleContract, expected) => {
      const tmp = mkdtempSync(join(tmpdir(), 'aionui-release-preflight-'));
      try {
        expect(() =>
          prepareAioncore({
            projectRoot: join(tmp, 'project'),
            platform: 'darwin',
            arch: 'arm64',
            version,
            releaseBundleContract,
          })
        ).toThrow(expected);
        expect(existsSync(join(tmp, 'project', 'resources'))).toBe(false);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
  );

  it('requires the exact complete v0.1.55 bundle on the two approved release targets', () => {
    const contract = getDefaultReleaseBundleContract();

    expect(contract).toEqual({
      repository: 'khoapnt-vng/aioncore',
      exactVersion: '0.1.55',
      expectedLineage: acceptedMigrationLineage,
      expectedSourceCommit: ACCEPTED_AIONCORE_SOURCE_COMMIT,
      allowedRuntimeKeys: ['darwin-arm64', 'win32-x64'],
      requireCompleteBundle: true,
    });
  });

  it.each([
    ['repository', 'untrusted/aioncore', /repository does not match/],
    ['version', '0.1.99', /version does not match/],
    ['sourceCommit', '0'.repeat(40), /source commit does not match/],
    ['target', 'x86_64-pc-windows-msvc', /target does not match/],
  ])('rejects a complete bundle whose %s provenance is wrong', (field, value, expected) => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-release-provenance-'));
    createCompleteLocalBundle(tmp, 'darwin', 'arm64');
    sealReleaseBundle(tmp, 'darwin', 'arm64');
    updateReleaseManifest(tmp, (manifest) => {
      manifest[field] = value;
    });
    try {
      expect(() => verifyReleaseFixture(tmp)).toThrow(expected);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects a complete bundle outside the caller-provided target contract', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-release-target-contract-'));
    createCompleteLocalBundle(tmp, 'darwin', 'arm64');
    sealReleaseBundle(tmp, 'darwin', 'arm64');
    try {
      expect(() => verifyReleaseFixture(tmp, { allowedRuntimeKeys: ['win32-x64'] })).toThrow(
        /target is not allowed by this bundle contract/
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects a disallowed preparation target before selecting a download or local source', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-release-target-preflight-'));
    try {
      expect(() =>
        prepareAioncore({
          projectRoot: join(tmp, 'project'),
          platform: 'darwin',
          arch: 'arm64',
          version: 'latest',
          releaseBundleContract: {
            repository: AIONCORE_RELEASE_REPOSITORY,
            exactVersion: '0.1.55',
            expectedSourceCommit: ACCEPTED_AIONCORE_SOURCE_COMMIT,
            expectedLineage: acceptedMigrationLineage,
            allowedRuntimeKeys: ['win32-x64'],
            requireCompleteBundle: true,
          },
        })
      ).toThrow(/target is not allowed by this bundle contract/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('checks migration evidence against the caller-provided version lineage contract', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-release-lineage-contract-'));
    createCompleteLocalBundle(tmp, 'darwin', 'arm64');
    sealReleaseBundle(tmp, 'darwin', 'arm64');
    try {
      expect(() =>
        verifyReleaseFixture(tmp, {
          expectedLineage: { ...acceptedMigrationLineage, fingerprint: '0'.repeat(64) },
        })
      ).toThrow(/migration lineage does not match/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects an internal SHA256SUMS digest that does not match the preserved manifest', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-release-checksums-'));
    createCompleteLocalBundle(tmp, 'darwin', 'arm64');
    sealReleaseBundle(tmp, 'darwin', 'arm64');
    const checksumPath = join(tmp, 'SHA256SUMS');
    const checksumText = readFileSync(checksumPath, 'utf8');
    writeFileSync(
      checksumPath,
      checksumText.replace(/^[0-9a-f]{64}(  bundle-manifest\.json)$/m, `${'0'.repeat(64)}$1`)
    );
    try {
      expect(() => verifyReleaseFixture(tmp)).toThrow(/SHA256SUMS mismatch: bundle-manifest\.json/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('accepts the Windows release checksum document with CRLF line endings', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-release-windows-checksums-'));
    createCompleteLocalBundle(tmp, 'win32', 'x64');
    sealReleaseBundle(tmp, 'win32', 'x64', { target: 'x86_64-pc-windows-msvc' });
    const checksumPath = join(tmp, 'SHA256SUMS');
    writeFileSync(checksumPath, readFileSync(checksumPath, 'utf8').replaceAll('\n', '\r\n'));
    try {
      expect(() =>
        verifyReleaseFixture(tmp, {
          platform: 'win32',
          arch: 'x64',
          allowedRuntimeKeys: ['win32-x64'],
        })
      ).not.toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects a payload whose bytes no longer match the release manifest', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-release-payload-hash-'));
    createCompleteLocalBundle(tmp, 'darwin', 'arm64');
    sealReleaseBundle(tmp, 'darwin', 'arm64');
    writeFileSync(join(tmp, 'aioncore'), 'changed-after-assembly');
    try {
      expect(() => verifyReleaseFixture(tmp)).toThrow(/manifest payload hash does not match: aioncore/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects a complete bundle with no target-matched OfficeCLI payload', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-release-officecli-'));
    createCompleteLocalBundle(tmp, 'darwin', 'arm64');
    sealReleaseBundle(tmp, 'darwin', 'arm64');
    unlinkSync(join(tmp, 'managed-resources', 'office', 'officecli'));
    try {
      expect(() => verifyReleaseFixture(tmp)).toThrow(/missing the required officecli payload/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects traversal in the release manifest before resolving any payload path', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-release-path-'));
    createCompleteLocalBundle(tmp, 'darwin', 'arm64');
    sealReleaseBundle(tmp, 'darwin', 'arm64');
    updateReleaseManifest(tmp, (manifest) => {
      const files = manifest.files as Array<Record<string, unknown>>;
      files[0].path = '../outside';
    });
    try {
      expect(() => verifyReleaseFixture(tmp)).toThrow(/invalid file entry/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  const symlinkIt = process.platform === 'win32' ? it.skip : it;
  symlinkIt('rejects a managed-resource symlink that escapes the complete bundle', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-release-symlink-'));
    const bundle = join(tmp, 'bundle');
    const outside = join(tmp, 'outside-officecli');
    createCompleteLocalBundle(bundle, 'darwin', 'arm64');
    sealReleaseBundle(bundle, 'darwin', 'arm64');
    writeFileSync(outside, 'outside');
    const officeCli = join(bundle, 'managed-resources', 'office', 'officecli');
    unlinkSync(officeCli);
    symlinkSync(outside, officeCli);
    try {
      expect(() => verifyReleaseFixture(bundle)).toThrow(/contains a symbolic link/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails closed when an explicit local bundle has no migration lineage document', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-local-bundle-lineage-'));
    const projectRoot = join(tmp, 'project');
    const localBundle = join(tmp, 'bundle');
    mkdirSync(join(localBundle, 'managed-resources'), { recursive: true });
    writeFileSync(join(localBundle, 'aioncore'), '');

    const previous = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = localBundle;
    try {
      expect(() =>
        prepareAioncore({
          projectRoot,
          platform: 'darwin',
          arch: 'arm64',
          version: 'v0.1.50',
          releaseBundleContract: legacyFixtureContract(['darwin-arm64']),
        })
      ).toThrow(/missing a valid migration-lineage\.json/);
    } finally {
      if (previous === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
      else process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previous;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('preserves relative links when copying a complete local bundle', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-local-bundle-links-'));
    const projectRoot = join(tmp, 'project');
    const localBundle = join(tmp, 'bundle');
    const managedResources = join(localBundle, 'managed-resources');
    const nodeRoot = join(managedResources, 'node', 'node-v24.11.0-darwin-arm64');
    const nodeBin = join(nodeRoot, 'bin');
    const npmBin = join(nodeRoot, 'lib', 'node_modules', 'npm', 'bin');
    const claudeRoot = join(managedResources, 'cli', 'claude', '2.1.215', 'darwin-arm64');
    const codexRoot = join(managedResources, 'cli', 'codex', '0.144.6', 'darwin-arm64');

    mkdirSync(nodeBin, { recursive: true });
    mkdirSync(npmBin, { recursive: true });
    mkdirSync(claudeRoot, { recursive: true });
    mkdirSync(join(codexRoot, 'vendor', 'aarch64-apple-darwin', 'bin'), { recursive: true });
    mkdirSync(join(codexRoot, 'vendor', 'aarch64-apple-darwin', 'codex-resources'), { recursive: true });
    writeFileSync(join(localBundle, 'aioncore'), '');
    writeFileSync(
      join(localBundle, 'migration-lineage.json'),
      `${JSON.stringify(acceptedMigrationLineage, null, 2)}\n`
    );
    writeFileSync(join(nodeBin, 'node'), '');
    writeFileSync(join(npmBin, 'npm-cli.js'), '');
    writeFileSync(join(claudeRoot, 'claude'), '');
    writeFileSync(join(codexRoot, 'vendor', 'aarch64-apple-darwin', 'bin', 'codex'), '');
    symlinkSync('../lib/node_modules/npm/bin/npm-cli.js', join(nodeBin, 'npm'));
    writeFileSync(
      join(managedResources, 'manifest.json'),
      `${JSON.stringify(
        {
          schemaVersion: 2,
          runtimeKey: 'darwin-arm64',
          node: {
            version: '24.11.0',
            root: 'node/node-v24.11.0-darwin-arm64',
            executable: 'bin/node',
          },
          clis: [
            {
              name: 'claude',
              version: '2.1.215',
              root: 'cli/claude/2.1.215/darwin-arm64',
              platformDirectory: 'darwin-arm64',
              executable: 'claude',
              requiredFiles: [],
              requiredDirectories: [],
            },
            {
              name: 'codex',
              version: '0.144.6',
              root: 'cli/codex/0.144.6/darwin-arm64',
              platformDirectory: 'darwin-arm64',
              executable: 'vendor/aarch64-apple-darwin/bin/codex',
              requiredFiles: [],
              requiredDirectories: ['vendor/aarch64-apple-darwin/codex-resources'],
            },
          ],
        },
        null,
        2
      )}\n`
    );

    const previous = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = localBundle;
    try {
      prepareAioncore({
        projectRoot,
        platform: 'darwin',
        arch: 'arm64',
        version: 'v0.1.55-appops-e582874c',
        releaseBundleContract: legacyFixtureContract(['darwin-arm64']),
      });

      expect(
        readlinkSync(
          join(
            projectRoot,
            'resources',
            'bundled-aioncore',
            'darwin-arm64',
            'managed-resources',
            'node',
            'node-v24.11.0-darwin-arm64',
            'bin',
            'npm'
          )
        )
      ).toBe('../lib/node_modules/npm/bin/npm-cli.js');
    } finally {
      if (previous === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
      else process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previous;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('hard fails local bundle input that lacks managed-resources manifest', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-local-bundle-'));
    const projectRoot = join(tmp, 'project');
    const localBundle = join(tmp, 'bundle');
    mkdirSync(join(localBundle, 'managed-resources'), { recursive: true });
    writeFileSync(join(localBundle, 'aioncore.exe'), '');
    writeFileSync(
      join(localBundle, 'migration-lineage.json'),
      `${JSON.stringify(acceptedMigrationLineage, null, 2)}\n`
    );

    const previous = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = localBundle;
    try {
      expect(() =>
        prepareAioncore({
          projectRoot,
          platform: 'win32',
          arch: 'x64',
          version: 'v0.1.46',
          releaseBundleContract: legacyFixtureContract(['win32-x64']),
        })
      ).toThrow(/managed-resources\/manifest\.json/);
    } finally {
      if (previous === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
      else process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previous;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('preserves the exact accepted lineage across legacy local-bundle target fixtures', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-lineage-targets-'));
    const targets = [
      ['darwin', 'arm64'],
      ['darwin', 'x64'],
      ['win32', 'x64'],
      ['win32', 'arm64'],
    ] as const;
    const previous = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;

    try {
      const lineages = targets.map(([platform, arch]) => {
        const runtimeKey = `${platform}-${arch}`;
        const localBundle = join(tmp, runtimeKey, 'bundle');
        const projectRoot = join(tmp, runtimeKey, 'project');
        createCompleteLocalBundle(localBundle, platform, arch);
        process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = localBundle;
        prepareAioncore({
          projectRoot,
          platform,
          arch,
          version: 'v0.1.50',
          releaseBundleContract: legacyFixtureContract(
            targets.map(([targetPlatform, targetArch]) => `${targetPlatform}-${targetArch}`)
          ),
        });
        const preparedRoot = join(projectRoot, 'resources', 'bundled-aioncore', runtimeKey);
        const manifest = JSON.parse(readFileSync(join(preparedRoot, 'manifest.json'), 'utf8'));
        const document = JSON.parse(readFileSync(join(preparedRoot, 'migration-lineage.json'), 'utf8'));
        expect(document).toEqual(acceptedMigrationLineage);
        expect(manifest.migrationLineage.entries).toEqual(acceptedMigrationLineage.entries);
        return manifest.migrationLineage;
      });

      expect(lineages[0]).toEqual(lineages[1]);
      expect(lineages[1]).toEqual(lineages[2]);
      expect(lineages[2]).toEqual(lineages[3]);
      expect(lineages[0].fingerprint).toBe(acceptedMigrationLineage.fingerprint);
      expect(lineages[0].minimumSupportedVersion).toBe(acceptedMigrationLineage.minimumSupportedVersion);
    } finally {
      if (previous === undefined) delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
      else process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previous;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
