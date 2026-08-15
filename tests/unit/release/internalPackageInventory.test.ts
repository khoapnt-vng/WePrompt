import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

const {
  expectedFromReleaseRecord,
  verifyInternalPackage,
} = require('../../../scripts/release/verify-internal-package');
const { validateArtifactIndex } = require('../../../scripts/release/create-artifact-index');
const { writeInternalReleaseMarker } = require('../../../scripts/afterPack');

const WEPROMPT_COMMIT = 'a'.repeat(40);
const AIONCORE_COMMIT = 'b'.repeat(40);
const LINEAGE_FINGERPRINT = 'c'.repeat(64);
const templates = JSON.parse(
  readFileSync(join(__dirname, '../../../packages/desktop/resources/presentation-templates/manifest.json'), 'utf8')
);
const roots: string[] = [];

const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createPackageFixture(platform: 'macos-arm64' | 'windows-x64') {
  const root = mkdtempSync(join(tmpdir(), 'weprompt-internal-package-'));
  roots.push(root);
  const resourcesDir = join(root, 'resources');
  const runtimeKey = platform === 'macos-arm64' ? 'darwin-arm64' : 'win32-x64';
  const target = platform === 'macos-arm64' ? 'aarch64-apple-darwin' : 'x86_64-pc-windows-msvc';
  const binaryName = platform === 'macos-arm64' ? 'aioncore' : 'aioncore.exe';
  const officeCliName = platform === 'macos-arm64' ? 'officecli' : 'officecli.exe';
  const runtimeRoot = join(resourcesDir, 'bundled-aioncore', runtimeKey);
  const managedRoot = join(runtimeRoot, 'managed-resources');
  const templateRoot = join(resourcesDir, 'presentation-templates');
  mkdirSync(join(managedRoot, 'office'), { recursive: true });
  mkdirSync(templateRoot, { recursive: true });

  const binary = Buffer.from(`aioncore-${target}\n`);
  const officeCli = Buffer.from(`officecli-${target}\n`);
  const lineage = {
    schemaVersion: 1,
    minimumSupportedVersion: 19,
    latestVersion: 28,
    entryCount: 28,
    fingerprint: LINEAGE_FINGERPRINT,
    entries: [],
  };
  writeFileSync(join(runtimeRoot, binaryName), binary);
  writeFileSync(join(managedRoot, 'office', officeCliName), officeCli);
  writeJson(join(runtimeRoot, 'migration-lineage.json'), lineage);

  const payloadPaths = [binaryName, 'managed-resources/office/' + officeCliName, 'migration-lineage.json'].toSorted();
  const files = payloadPaths.map((path) => {
    const bytes = readFileSync(join(runtimeRoot, path));
    return { path, sha256: sha256(bytes), size: bytes.length };
  });
  const manifest = {
    schemaVersion: 1,
    repository: 'khoapnt-vng/aioncore',
    version: 'v0.1.55',
    sourceCommit: AIONCORE_COMMIT,
    target,
    builtAt: '2026-08-15T10:00:00Z',
    migrationLineage: {
      schemaVersion: 1,
      minimumSupportedVersion: 19,
      latestVersion: 28,
      entryCount: 28,
      fingerprint: LINEAGE_FINGERPRINT,
    },
    files,
  };
  writeJson(join(runtimeRoot, 'bundle-manifest.json'), manifest);
  const checksumPaths = [...payloadPaths, 'bundle-manifest.json'].toSorted();
  writeFileSync(
    join(runtimeRoot, 'SHA256SUMS'),
    checksumPaths.map((path) => `${sha256(readFileSync(join(runtimeRoot, path)))}  ${path}`).join('\n') + '\n'
  );

  writeJson(join(templateRoot, 'manifest.json'), templates);
  for (const entry of templates) {
    if (entry.packagedReferenceFile) writeFileSync(join(templateRoot, entry.packagedReferenceFile), entry.id);
  }
  writeJson(join(resourcesDir, 'internal-release.json'), {
    schemaVersion: 1,
    channel: 'internal',
    wepromptCommit: WEPROMPT_COMMIT,
    platform,
    unsigned: true,
    creativeStudioEnabled: false,
    autoUpdateEnabled: false,
    sentryEnabled: false,
  });

  return {
    root,
    resourcesDir,
    runtimeRoot,
    platform,
    target,
    runtimeKey,
    binaryName,
    officeCliName,
    expected: {
      wepromptCommit: WEPROMPT_COMMIT,
      aioncoreVersion: 'v0.1.55',
      aioncoreCommit: AIONCORE_COMMIT,
      migrationLineageFingerprint: LINEAGE_FINGERPRINT,
      target,
      binarySha256: sha256(binary),
      bundleManifestSha256: sha256(readFileSync(join(runtimeRoot, 'bundle-manifest.json'))),
    },
  };
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('internal package verification', () => {
  it('writes an exact fail-closed policy marker only for the approved internal targets', () => {
    const fixture = createPackageFixture('windows-x64');
    rmSync(join(fixture.resourcesDir, 'internal-release.json'));

    expect(
      writeInternalReleaseMarker(fixture.resourcesDir, 'win32', 'x64', {
        WEPROMPT_INTERNAL_RELEASE: '1',
        WEPROMPT_RELEASE_COMMIT: WEPROMPT_COMMIT,
      })
    ).toEqual(join(fixture.resourcesDir, 'internal-release.json'));
    expect(JSON.parse(readFileSync(join(fixture.resourcesDir, 'internal-release.json'), 'utf8'))).toMatchObject({
      wepromptCommit: WEPROMPT_COMMIT,
      platform: 'windows-x64',
      unsigned: true,
      creativeStudioEnabled: false,
      autoUpdateEnabled: false,
      sentryEnabled: false,
    });
    expect(
      writeInternalReleaseMarker(fixture.resourcesDir, 'win32', 'x64', {
        WEPROMPT_INTERNAL_RELEASE: '1',
        WEPROMPT_RELEASE_COMMIT: WEPROMPT_COMMIT,
      })
    ).toEqual(join(fixture.resourcesDir, 'internal-release.json'));
    expect(() =>
      writeInternalReleaseMarker(fixture.resourcesDir, 'win32', 'x64', {
        WEPROMPT_INTERNAL_RELEASE: '1',
        WEPROMPT_RELEASE_COMMIT: 'f'.repeat(40),
      })
    ).toThrow(/does not match/i);
    expect(writeInternalReleaseMarker(fixture.resourcesDir, 'win32', 'x64', {})).toBeNull();
    expect(() =>
      writeInternalReleaseMarker(fixture.resourcesDir, 'darwin', 'x64', {
        WEPROMPT_INTERNAL_RELEASE: '1',
        WEPROMPT_RELEASE_COMMIT: WEPROMPT_COMMIT,
      })
    ).toThrow(/approved internal target/i);
  });

  it.each(['windows-x64', 'macos-arm64'] as const)(
    'binds %s contents to exact WePrompt and AionCore identities',
    (platform) => {
      const fixture = createPackageFixture(platform);

      const result = verifyInternalPackage({
        resourcesDir: fixture.resourcesDir,
        platform,
        expected: fixture.expected,
      });

      expect(result).toMatchObject({
        platform,
        target: fixture.target,
        runtimeKey: fixture.runtimeKey,
        wepromptCommit: WEPROMPT_COMMIT,
        aioncoreCommit: AIONCORE_COMMIT,
        migrationLineageFingerprint: LINEAGE_FINGERPRINT,
        internal: true,
        unsigned: true,
        creativeStudioEnabled: false,
        autoUpdateEnabled: false,
        sentryEnabled: false,
        presentationTemplateCount: 8,
      });
      expect(result.officeCliPath).toBe(`managed-resources/office/${fixture.officeCliName}`);
    }
  );

  it('rejects changed backend bytes even when identity metadata is unchanged', () => {
    const fixture = createPackageFixture('macos-arm64');
    writeFileSync(join(fixture.runtimeRoot, fixture.binaryName), 'tampered');

    expect(() =>
      verifyInternalPackage({
        resourcesDir: fixture.resourcesDir,
        platform: fixture.platform,
        expected: fixture.expected,
      })
    ).toThrow(/payload hash mismatch|binary hash mismatch/i);
  });

  it('rejects missing OfficeCLI, templates, or a second out-of-scope runtime', () => {
    const officeFixture = createPackageFixture('windows-x64');
    rmSync(join(officeFixture.runtimeRoot, 'managed-resources', 'office', officeFixture.officeCliName));
    expect(() =>
      verifyInternalPackage({
        resourcesDir: officeFixture.resourcesDir,
        platform: officeFixture.platform,
        expected: officeFixture.expected,
      })
    ).toThrow(/officecli/i);

    const templateFixture = createPackageFixture('macos-arm64');
    const reference = templates.find((entry: { packagedReferenceFile?: string }) => entry.packagedReferenceFile)!;
    rmSync(join(templateFixture.resourcesDir, 'presentation-templates', reference.packagedReferenceFile));
    expect(() =>
      verifyInternalPackage({
        resourcesDir: templateFixture.resourcesDir,
        platform: templateFixture.platform,
        expected: templateFixture.expected,
      })
    ).toThrow(/template/i);

    const isolationFixture = createPackageFixture('windows-x64');
    mkdirSync(join(isolationFixture.resourcesDir, 'bundled-aioncore', 'darwin-arm64'));
    expect(() =>
      verifyInternalPackage({
        resourcesDir: isolationFixture.resourcesDir,
        platform: isolationFixture.platform,
        expected: isolationFixture.expected,
      })
    ).toThrow(/exactly one bundled AionCore runtime/i);
  });

  it('rejects enabled Studio/update/Sentry policy and commit or target drift', () => {
    for (const key of ['creativeStudioEnabled', 'autoUpdateEnabled', 'sentryEnabled'] as const) {
      const fixture = createPackageFixture('windows-x64');
      const markerPath = join(fixture.resourcesDir, 'internal-release.json');
      const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
      writeJson(markerPath, { ...marker, [key]: true });
      expect(() =>
        verifyInternalPackage({
          resourcesDir: fixture.resourcesDir,
          platform: fixture.platform,
          expected: fixture.expected,
        })
      ).toThrow(new RegExp(key, 'i'));
    }

    const commitFixture = createPackageFixture('macos-arm64');
    expect(() =>
      verifyInternalPackage({
        resourcesDir: commitFixture.resourcesDir,
        platform: commitFixture.platform,
        expected: { ...commitFixture.expected, wepromptCommit: 'f'.repeat(40) },
      })
    ).toThrow(/WePrompt commit mismatch/i);

    const targetFixture = createPackageFixture('windows-x64');
    expect(() =>
      verifyInternalPackage({
        resourcesDir: targetFixture.resourcesDir,
        platform: targetFixture.platform,
        expected: { ...targetFixture.expected, target: 'aarch64-apple-darwin' },
      })
    ).toThrow(/target mismatch/i);
  });

  it('selects exact target hashes from the independently verified AionCore handoff', () => {
    const fixture = createPackageFixture('windows-x64');
    const record = {
      schemaVersion: 1,
      repository: 'khoapnt-vng/aioncore',
      version: 'v0.1.55',
      tagCommit: AIONCORE_COMMIT,
      migrationLineageFingerprint: LINEAGE_FINGERPRINT,
      assets: [
        {
          target: 'aarch64-apple-darwin',
          name: 'mac.tar.gz',
          sha256: '1'.repeat(64),
          binarySha256: '2'.repeat(64),
          bundleManifestSha256: '3'.repeat(64),
        },
        {
          target: fixture.target,
          name: 'windows.zip',
          sha256: '4'.repeat(64),
          binarySha256: fixture.expected.binarySha256,
          bundleManifestSha256: fixture.expected.bundleManifestSha256,
        },
      ],
    };

    expect(expectedFromReleaseRecord(record, 'windows-x64', WEPROMPT_COMMIT)).toEqual(fixture.expected);
    expect(() =>
      expectedFromReleaseRecord(
        { ...record, assets: record.assets.filter((asset) => asset.target !== fixture.target) },
        'windows-x64',
        WEPROMPT_COMMIT
      )
    ).toThrow(/invalid.*handoff|lacks valid/i);
  });
});

describe('internal artifact index', () => {
  const artifact = (platform: 'windows-x64' | 'macos-arm64', name: string, sha: string) => ({
    platform,
    target: platform === 'windows-x64' ? 'x86_64-pc-windows-msvc' : 'aarch64-apple-darwin',
    name,
    sha256: sha,
    wepromptCommit: WEPROMPT_COMMIT,
    aioncoreVersion: 'v0.1.55',
    aioncoreCommit: AIONCORE_COMMIT,
    aioncoreBinarySha256: platform === 'windows-x64' ? '3'.repeat(64) : '4'.repeat(64),
    bundleManifestSha256: platform === 'windows-x64' ? '5'.repeat(64) : '6'.repeat(64),
    migrationLineageFingerprint: LINEAGE_FINGERPRINT,
    internal: true,
    unsigned: true,
    creativeStudioEnabled: false,
    autoUpdateEnabled: false,
    sentryEnabled: false,
  });

  it('accepts exactly Windows first and macOS ARM64 from one RC and backend', () => {
    const index = {
      schemaVersion: 1,
      state: 'held_not_approved',
      artifacts: [
        artifact('windows-x64', 'WePrompt-win-x64.exe', '1'.repeat(64)),
        artifact('macos-arm64', 'WePrompt-mac-arm64.dmg', '2'.repeat(64)),
      ],
    };

    expect(validateArtifactIndex(index)).toEqual(index);
  });

  it.each([
    [
      'macOS first',
      [
        artifact('macos-arm64', 'WePrompt-mac-arm64.dmg', '2'.repeat(64)),
        artifact('windows-x64', 'WePrompt-win-x64.exe', '1'.repeat(64)),
      ],
    ],
    ['one target', [artifact('windows-x64', 'WePrompt-win-x64.exe', '1'.repeat(64))]],
    [
      'duplicate name',
      [artifact('windows-x64', 'same', '1'.repeat(64)), artifact('macos-arm64', 'same', '2'.repeat(64))],
    ],
    [
      'duplicate hash',
      [artifact('windows-x64', 'win.exe', '1'.repeat(64)), artifact('macos-arm64', 'mac.dmg', '1'.repeat(64))],
    ],
    [
      'different RC',
      [
        artifact('windows-x64', 'win.exe', '1'.repeat(64)),
        { ...artifact('macos-arm64', 'mac.dmg', '2'.repeat(64)), wepromptCommit: 'd'.repeat(40) },
      ],
    ],
  ])('rejects %s', (_name, artifacts) => {
    expect(() => validateArtifactIndex({ schemaVersion: 1, state: 'held_not_approved', artifacts })).toThrow();
  });
});
