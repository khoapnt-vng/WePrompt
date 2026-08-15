#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { assertBundledRuntimeIsolation, verifyPresentationTemplateResources } = require('../afterPack');

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const PLATFORMS = {
  'macos-arm64': {
    electronPlatform: 'darwin',
    arch: 'arm64',
    runtimeKey: 'darwin-arm64',
    target: 'aarch64-apple-darwin',
    binaryName: 'aioncore',
    officeCliName: 'officecli',
  },
  'windows-x64': {
    electronPlatform: 'win32',
    arch: 'x64',
    runtimeKey: 'win32-x64',
    target: 'x86_64-pc-windows-msvc',
    binaryName: 'aioncore.exe',
    officeCliName: 'officecli.exe',
  },
};

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJson(filePath, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error(`${label} must be valid JSON: ${filePath}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} has invalid shape`);
}

function assertRegularFile(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    throw new Error(`${label} is missing: ${filePath}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file: ${filePath}`);
  return stat;
}

function assertNoSymlinks(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    const stat = fs.lstatSync(entryPath);
    if (stat.isSymbolicLink()) throw new Error(`package resources contain symlink: ${entryPath}`);
    if (stat.isDirectory()) assertNoSymlinks(entryPath);
  }
}

function relativeFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) files.push(path.relative(root, entryPath).split(path.sep).join('/'));
    }
  };
  visit(root);
  return files.sort();
}

function parseChecksums(filePath) {
  const entries = new Map();
  const lines = fs.readFileSync(filePath, 'utf8').trimEnd().split('\n');
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  ([^\\]+)$/.exec(line);
    if (!match || path.posix.isAbsolute(match[2]) || match[2].split('/').includes('..') || entries.has(match[2])) {
      throw new Error('invalid AionCore SHA256SUMS');
    }
    entries.set(match[2], match[1]);
  }
  return entries;
}

function verifyPolicyMarker(resourcesDir, platform, expectedCommit) {
  const marker = readJson(path.join(resourcesDir, 'internal-release.json'), 'internal release marker');
  assertExactKeys(
    marker,
    [
      'schemaVersion',
      'channel',
      'wepromptCommit',
      'platform',
      'unsigned',
      'creativeStudioEnabled',
      'autoUpdateEnabled',
      'sentryEnabled',
    ],
    'internal release marker'
  );
  if (marker.schemaVersion !== 1 || marker.channel !== 'internal') throw new Error('invalid internal release marker');
  if (!COMMIT.test(marker.wepromptCommit) || marker.wepromptCommit !== expectedCommit) {
    throw new Error('WePrompt commit mismatch in internal release marker');
  }
  if (marker.platform !== platform) throw new Error('platform mismatch in internal release marker');
  if (marker.unsigned !== true) throw new Error('unsigned policy must be true');
  for (const key of ['creativeStudioEnabled', 'autoUpdateEnabled', 'sentryEnabled']) {
    if (marker[key] !== false) throw new Error(`${key} must be false for internal release`);
  }
  for (const forbidden of ['app-update.yml', 'dev-app-update.yml']) {
    if (fs.existsSync(path.join(resourcesDir, forbidden)))
      throw new Error(`forbidden update configuration: ${forbidden}`);
  }
  return marker;
}

function verifyBundle(runtimeRoot, platformConfig, expected) {
  assertNoSymlinks(runtimeRoot);
  const topLevel = fs.readdirSync(runtimeRoot).sort();
  const expectedTopLevel = [
    platformConfig.binaryName,
    'SHA256SUMS',
    'bundle-manifest.json',
    'managed-resources',
    'migration-lineage.json',
  ].sort();
  if (JSON.stringify(topLevel) !== JSON.stringify(expectedTopLevel)) {
    throw new Error('AionCore bundle top-level member set mismatch');
  }

  const manifestPath = path.join(runtimeRoot, 'bundle-manifest.json');
  const manifest = readJson(manifestPath, 'AionCore bundle manifest');
  assertExactKeys(
    manifest,
    ['schemaVersion', 'repository', 'version', 'sourceCommit', 'target', 'builtAt', 'migrationLineage', 'files'],
    'AionCore bundle manifest'
  );
  if (manifest.schemaVersion !== 1 || manifest.repository !== 'khoapnt-vng/aioncore') {
    throw new Error('invalid AionCore bundle manifest identity');
  }
  if (manifest.version !== expected.aioncoreVersion) throw new Error('AionCore version mismatch');
  if (manifest.sourceCommit !== expected.aioncoreCommit) throw new Error('AionCore source commit mismatch');
  if (manifest.target !== expected.target || manifest.target !== platformConfig.target) {
    throw new Error('AionCore target mismatch');
  }
  if (!SHA256.test(expected.bundleManifestSha256) || sha256File(manifestPath) !== expected.bundleManifestSha256) {
    throw new Error('AionCore bundle manifest hash mismatch');
  }

  const lineage = readJson(path.join(runtimeRoot, 'migration-lineage.json'), 'migration lineage');
  if (
    lineage.fingerprint !== expected.migrationLineageFingerprint ||
    manifest.migrationLineage?.fingerprint !== expected.migrationLineageFingerprint
  ) {
    throw new Error('migration lineage fingerprint mismatch');
  }

  if (!Array.isArray(manifest.files)) throw new Error('AionCore manifest files must be an array');
  const officeCliRelative = `managed-resources/office/${platformConfig.officeCliName}`;
  assertRegularFile(path.join(runtimeRoot, officeCliRelative), 'OfficeCLI');
  const entries = new Map();
  for (const entry of manifest.files) {
    if (
      !entry ||
      typeof entry.path !== 'string' ||
      path.posix.isAbsolute(entry.path) ||
      entry.path.split('/').includes('..') ||
      !SHA256.test(entry.sha256 ?? '') ||
      !Number.isInteger(entry.size) ||
      entry.size < 0 ||
      entries.has(entry.path)
    ) {
      throw new Error('invalid AionCore payload manifest entry');
    }
    entries.set(entry.path, entry);
  }
  const actualPayloads = relativeFiles(runtimeRoot).filter(
    (relative) => relative !== 'bundle-manifest.json' && relative !== 'SHA256SUMS'
  );
  if (JSON.stringify([...entries.keys()].sort()) !== JSON.stringify(actualPayloads)) {
    throw new Error('AionCore payload inventory mismatch');
  }
  for (const [relative, entry] of entries) {
    const payloadPath = path.join(runtimeRoot, relative);
    const stat = assertRegularFile(payloadPath, `AionCore payload ${relative}`);
    if (stat.size !== entry.size || sha256File(payloadPath) !== entry.sha256) {
      throw new Error(`AionCore payload hash mismatch: ${relative}`);
    }
  }

  const checksums = parseChecksums(path.join(runtimeRoot, 'SHA256SUMS'));
  const expectedChecksumPaths = [...actualPayloads, 'bundle-manifest.json'].sort();
  if (JSON.stringify([...checksums.keys()].sort()) !== JSON.stringify(expectedChecksumPaths)) {
    throw new Error('AionCore checksum coverage mismatch');
  }
  for (const [relative, digest] of checksums) {
    if (sha256File(path.join(runtimeRoot, relative)) !== digest)
      throw new Error(`AionCore checksum mismatch: ${relative}`);
  }

  const binaryPath = path.join(runtimeRoot, platformConfig.binaryName);
  if (!SHA256.test(expected.binarySha256) || sha256File(binaryPath) !== expected.binarySha256) {
    throw new Error('AionCore binary hash mismatch');
  }
  return { manifest, officeCliRelative };
}

function verifyInternalPackage({ resourcesDir, platform, expected }) {
  const platformConfig = PLATFORMS[platform];
  if (!platformConfig) throw new Error(`unsupported internal release platform: ${platform}`);
  if (!expected || !COMMIT.test(expected.wepromptCommit ?? '') || !COMMIT.test(expected.aioncoreCommit ?? '')) {
    throw new Error('expected exact WePrompt and AionCore commits');
  }
  if (expected.target !== platformConfig.target) throw new Error('expected target mismatch for platform');
  if (!SHA256.test(expected.migrationLineageFingerprint ?? '')) throw new Error('invalid expected lineage fingerprint');
  assertNoSymlinks(resourcesDir);
  const marker = verifyPolicyMarker(resourcesDir, platform, expected.wepromptCommit);
  const runtimeKey = assertBundledRuntimeIsolation(resourcesDir, platformConfig.electronPlatform, platformConfig.arch);
  const runtimeRoot = path.join(resourcesDir, 'bundled-aioncore', runtimeKey);
  const { manifest, officeCliRelative } = verifyBundle(runtimeRoot, platformConfig, expected);
  const templateReferences = verifyPresentationTemplateResources(resourcesDir);

  return {
    platform,
    target: platformConfig.target,
    runtimeKey,
    wepromptCommit: marker.wepromptCommit,
    aioncoreVersion: manifest.version,
    aioncoreCommit: manifest.sourceCommit,
    migrationLineageFingerprint: manifest.migrationLineage.fingerprint,
    aioncoreBinarySha256: expected.binarySha256,
    bundleManifestSha256: expected.bundleManifestSha256,
    officeCliPath: officeCliRelative,
    internal: true,
    unsigned: marker.unsigned,
    creativeStudioEnabled: marker.creativeStudioEnabled,
    autoUpdateEnabled: marker.autoUpdateEnabled,
    sentryEnabled: marker.sentryEnabled,
    presentationTemplateCount: templateReferences.length,
  };
}

function expectedFromReleaseRecord(record, platform, wepromptCommit) {
  const platformConfig = PLATFORMS[platform];
  if (!platformConfig) throw new Error(`unsupported internal release platform: ${platform}`);
  if (
    !record ||
    record.schemaVersion !== 1 ||
    record.repository !== 'khoapnt-vng/aioncore' ||
    record.version !== 'v0.1.55' ||
    !COMMIT.test(record.tagCommit ?? '') ||
    !SHA256.test(record.migrationLineageFingerprint ?? '') ||
    !Array.isArray(record.assets) ||
    record.assets.length !== 2
  ) {
    throw new Error('invalid AionCore v0.1.55 release handoff record');
  }
  const asset = record.assets.find((candidate) => candidate.target === platformConfig.target);
  if (
    !asset ||
    !SHA256.test(asset.sha256 ?? '') ||
    !SHA256.test(asset.binarySha256 ?? '') ||
    !SHA256.test(asset.bundleManifestSha256 ?? '')
  ) {
    throw new Error(`AionCore release handoff lacks valid ${platformConfig.target} asset hashes`);
  }
  return {
    wepromptCommit,
    aioncoreVersion: record.version,
    aioncoreCommit: record.tagCommit,
    migrationLineageFingerprint: record.migrationLineageFingerprint,
    target: platformConfig.target,
    binarySha256: asset.binarySha256,
    bundleManifestSha256: asset.bundleManifestSha256,
  };
}

function parseCli(argv) {
  if (argv.length !== 10) {
    throw new Error(
      'usage: verify-internal-package.js --aioncore-record <json> --platform <platform> --resources-dir <dir> --weprompt-commit <sha> --output <json>'
    );
  }
  const values = {};
  for (let index = 0; index < argv.length; index += 2) values[argv[index]] = argv[index + 1];
  for (const option of ['--aioncore-record', '--platform', '--resources-dir', '--weprompt-commit', '--output']) {
    if (!values[option]) throw new Error(`missing ${option}`);
  }
  return values;
}

function main(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  const releaseRecord = readJson(path.resolve(options['--aioncore-record']), 'AionCore release handoff');
  const expected = expectedFromReleaseRecord(releaseRecord, options['--platform'], options['--weprompt-commit']);
  const report = verifyInternalPackage({
    resourcesDir: path.resolve(options['--resources-dir']),
    platform: options['--platform'],
    expected,
  });
  const outputPath = path.resolve(options['--output']);
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporaryPath, outputPath);
  process.stdout.write(`Verified internal package contents: ${report.platform} ${report.wepromptCommit}\n`);
}

module.exports = { expectedFromReleaseRecord, verifyInternalPackage };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`internal package verification failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
