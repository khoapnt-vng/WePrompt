const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');

const AIONCORE_RELEASE_REPOSITORY = 'khoapnt-vng/aioncore';
const RELEASE_TARGETS = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
};
const RELEASE_METADATA_FILES = ['bundle-manifest.json', 'SHA256SUMS'];

class AioncoreReleaseBundleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AioncoreReleaseBundleError';
  }
}

function computeFileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).toSorted(), [...keys].toSorted())
  );
}

function readJsonObject(filePath, label) {
  let document;
  try {
    document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new AioncoreReleaseBundleError(`AionCore ${label} is not valid JSON.`);
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new AioncoreReleaseBundleError(`AionCore ${label} must contain a JSON object.`);
  }
  return document;
}

function normalizeExpectedVersion(version) {
  if (typeof version !== 'string' || !version.trim() || version === 'latest') {
    throw new AioncoreReleaseBundleError('AionCore complete bundles require an exact expected version.');
  }
  return version.trim().replace(/^v/, '');
}

function expectedReleaseTarget(platform, arch) {
  return RELEASE_TARGETS[`${platform}-${arch}`] || null;
}

function normalizeContractVersion(version, label) {
  if (typeof version !== 'string' || !version.trim() || version.trim() === 'latest') {
    throw new AioncoreReleaseBundleError(`AionCore ${label} must be an exact version.`);
  }
  return version.trim().replace(/^v/, '');
}

function validateAioncoreReleaseBundleContract({ contract, platform, arch, requestedVersion }) {
  if (contract === null || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new AioncoreReleaseBundleError('AionCore release bundle contract is missing.');
  }
  if (contract.repository !== AIONCORE_RELEASE_REPOSITORY) {
    throw new AioncoreReleaseBundleError('AionCore release bundle contract has an untrusted repository.');
  }
  if (
    contract.expectedLineage === null ||
    typeof contract.expectedLineage !== 'object' ||
    Array.isArray(contract.expectedLineage)
  ) {
    throw new AioncoreReleaseBundleError('AionCore release bundle contract has no expected migration lineage.');
  }
  if (!/^[0-9a-f]{40}$/.test(contract.expectedSourceCommit ?? '')) {
    throw new AioncoreReleaseBundleError('AionCore release bundle contract has no exact expected source commit.');
  }
  if (typeof contract.requireCompleteBundle !== 'boolean') {
    throw new AioncoreReleaseBundleError('AionCore release bundle contract must declare requireCompleteBundle.');
  }
  if (!Array.isArray(contract.allowedRuntimeKeys) || contract.allowedRuntimeKeys.length === 0) {
    throw new AioncoreReleaseBundleError('AionCore release bundle contract has no allowed runtime targets.');
  }
  const distinctRuntimeKeys = new Set(contract.allowedRuntimeKeys);
  if (
    distinctRuntimeKeys.size !== contract.allowedRuntimeKeys.length ||
    contract.allowedRuntimeKeys.some((runtimeKey) => !Object.hasOwn(RELEASE_TARGETS, runtimeKey))
  ) {
    throw new AioncoreReleaseBundleError('AionCore release bundle contract has an invalid runtime target.');
  }

  const runtimeKey = `${platform}-${arch}`;
  if (!distinctRuntimeKeys.has(runtimeKey)) {
    throw new AioncoreReleaseBundleError(
      `AionCore release target is not allowed by this bundle contract: ${runtimeKey}`
    );
  }
  const target = expectedReleaseTarget(platform, arch);
  if (!target) throw new AioncoreReleaseBundleError(`Unsupported AionCore release target: ${runtimeKey}`);

  let exactVersion = null;
  if (contract.exactVersion !== undefined && contract.exactVersion !== null) {
    exactVersion = normalizeContractVersion(contract.exactVersion, 'bundle contract version');
    const normalizedRequestedVersion = normalizeContractVersion(requestedVersion, 'requested version');
    if (normalizedRequestedVersion !== exactVersion) {
      throw new AioncoreReleaseBundleError(
        `AionCore requested version ${normalizedRequestedVersion} does not match bundle contract ${exactVersion}.`
      );
    }
  } else if (contract.requireCompleteBundle) {
    throw new AioncoreReleaseBundleError('A strict AionCore release bundle contract requires exactVersion.');
  }

  return { exactVersion, runtimeKey, target };
}

function isSafeBundleRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  if (value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return false;
  return path.posix.normalize(value) === value;
}

function listBundleFiles(bundleDir) {
  const files = [];

  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(directory, entry.name);
      const stats = fs.lstatSync(fullPath);
      if (stats.isSymbolicLink()) {
        throw new AioncoreReleaseBundleError(`AionCore bundle contains a symbolic link: ${relativePath}`);
      }
      if (stats.isDirectory()) {
        visit(fullPath, relativePath);
        continue;
      }
      if (!stats.isFile()) {
        throw new AioncoreReleaseBundleError(`AionCore bundle contains an unsupported file type: ${relativePath}`);
      }
      files.push(relativePath);
    }
  }

  visit(bundleDir);
  return files.toSorted();
}

function assertRegularFile(filePath, label) {
  let stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch {
    throw new AioncoreReleaseBundleError(`AionCore bundle is missing ${label}.`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new AioncoreReleaseBundleError(`AionCore bundle ${label} must be a regular file.`);
  }
  return stats;
}

function assertExactTopLevelMembers(bundleDir, binaryName, allowDesktopManifest) {
  const expected = new Set([
    binaryName,
    'migration-lineage.json',
    'managed-resources',
    'bundle-manifest.json',
    'SHA256SUMS',
    ...(allowDesktopManifest ? ['manifest.json'] : []),
  ]);
  const actual = new Set(fs.readdirSync(bundleDir));
  if (actual.size !== expected.size || [...expected].some((entry) => !actual.has(entry))) {
    throw new AioncoreReleaseBundleError('AionCore bundle top-level member set does not match the release contract.');
  }
  const managedStats = fs.lstatSync(path.join(bundleDir, 'managed-resources'));
  if (!managedStats.isDirectory() || managedStats.isSymbolicLink()) {
    throw new AioncoreReleaseBundleError('AionCore managed-resources must be a regular directory.');
  }
}

function assertOfficeCli(bundleDir, platform) {
  const officeDir = path.join(bundleDir, 'managed-resources', 'office');
  let officeStats;
  try {
    officeStats = fs.lstatSync(officeDir);
  } catch {
    throw new AioncoreReleaseBundleError('AionCore bundle is missing the required OfficeCLI directory.');
  }
  if (!officeStats.isDirectory() || officeStats.isSymbolicLink()) {
    throw new AioncoreReleaseBundleError('AionCore bundle OfficeCLI directory must be a regular directory.');
  }

  const officeCliName = platform === 'win32' ? 'officecli.exe' : 'officecli';
  const members = fs.readdirSync(officeDir);
  if (members.length !== 1 || members[0] !== officeCliName) {
    throw new AioncoreReleaseBundleError(`AionCore bundle is missing the required ${officeCliName} payload.`);
  }
  assertRegularFile(path.join(officeDir, officeCliName), `managed-resources/office/${officeCliName}`);
}

function expectedLineageSummary(expectedLineage) {
  const { entries: _entries, ...summary } = expectedLineage;
  return summary;
}

function assertLineage(bundleDir, manifest, expectedLineage) {
  const lineage = readJsonObject(path.join(bundleDir, 'migration-lineage.json'), 'migration-lineage.json');
  if (!isDeepStrictEqual(lineage, expectedLineage)) {
    throw new AioncoreReleaseBundleError('AionCore bundle migration lineage does not match the accepted lineage.');
  }
  if (!isDeepStrictEqual(manifest.migrationLineage, expectedLineageSummary(expectedLineage))) {
    throw new AioncoreReleaseBundleError('AionCore bundle manifest migration lineage summary does not match.');
  }
}

function validateManifest({ bundleDir, manifest, repository, version, sourceCommit, target, expectedLineage }) {
  const manifestKeys = [
    'schemaVersion',
    'repository',
    'version',
    'sourceCommit',
    'target',
    'builtAt',
    'migrationLineage',
    'files',
  ];
  if (!exactKeys(manifest, manifestKeys) || manifest.schemaVersion !== 1) {
    throw new AioncoreReleaseBundleError('AionCore bundle manifest has an invalid shape.');
  }
  if (manifest.repository !== repository) {
    throw new AioncoreReleaseBundleError('AionCore bundle manifest repository does not match the trusted publisher.');
  }
  if (manifest.version !== version) {
    throw new AioncoreReleaseBundleError('AionCore bundle manifest version does not match the requested release.');
  }
  if (manifest.sourceCommit !== sourceCommit) {
    throw new AioncoreReleaseBundleError('AionCore bundle manifest source commit does not match the trusted commit.');
  }
  if (manifest.target !== target) {
    throw new AioncoreReleaseBundleError('AionCore bundle manifest target does not match the requested runtime.');
  }
  if (
    typeof manifest.builtAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(manifest.builtAt) ||
    Number.isNaN(Date.parse(manifest.builtAt)) ||
    new Date(manifest.builtAt).toISOString().replace('.000Z', 'Z') !== manifest.builtAt
  ) {
    throw new AioncoreReleaseBundleError('AionCore bundle manifest builtAt timestamp is invalid.');
  }

  assertLineage(bundleDir, manifest, expectedLineage);
}

function validateManifestInventory(bundleDir, manifest, actualPayloads) {
  if (!Array.isArray(manifest.files)) {
    throw new AioncoreReleaseBundleError('AionCore bundle manifest files must be an array.');
  }

  const entries = new Map();
  const orderedPaths = [];
  for (const entry of manifest.files) {
    if (!exactKeys(entry, ['path', 'sha256', 'size']) || !isSafeBundleRelativePath(entry.path)) {
      throw new AioncoreReleaseBundleError('AionCore bundle manifest contains an invalid file entry.');
    }
    if (entries.has(entry.path)) {
      throw new AioncoreReleaseBundleError(`AionCore bundle manifest contains duplicate path: ${entry.path}`);
    }
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new AioncoreReleaseBundleError(`AionCore bundle manifest contains an invalid hash: ${entry.path}`);
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new AioncoreReleaseBundleError(`AionCore bundle manifest contains an invalid size: ${entry.path}`);
    }
    entries.set(entry.path, entry);
    orderedPaths.push(entry.path);
  }
  if (!isDeepStrictEqual(orderedPaths, [...orderedPaths].toSorted())) {
    throw new AioncoreReleaseBundleError('AionCore bundle manifest file entries are not sorted.');
  }
  if (!isDeepStrictEqual(orderedPaths, actualPayloads)) {
    throw new AioncoreReleaseBundleError('AionCore bundle manifest payload inventory does not match the archive.');
  }

  for (const [relativePath, entry] of entries) {
    const fullPath = path.join(bundleDir, ...relativePath.split('/'));
    const stats = assertRegularFile(fullPath, relativePath);
    if (stats.size !== entry.size || computeFileSha256(fullPath) !== entry.sha256) {
      throw new AioncoreReleaseBundleError(`AionCore bundle manifest payload hash does not match: ${relativePath}`);
    }
  }
}

function parseChecksums(checksumPath) {
  let contents;
  try {
    contents = fs.readFileSync(checksumPath, 'utf8');
  } catch {
    throw new AioncoreReleaseBundleError('AionCore bundle SHA256SUMS is unreadable.');
  }
  const lines = contents.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length === 0 || lines.some((line) => !line)) {
    throw new AioncoreReleaseBundleError('AionCore bundle SHA256SUMS has an invalid line.');
  }

  const checksums = new Map();
  const orderedPaths = [];
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match || !isSafeBundleRelativePath(match[2]) || checksums.has(match[2])) {
      throw new AioncoreReleaseBundleError('AionCore bundle SHA256SUMS has an invalid or duplicate path.');
    }
    checksums.set(match[2], match[1]);
    orderedPaths.push(match[2]);
  }
  if (!isDeepStrictEqual(orderedPaths, [...orderedPaths].toSorted())) {
    throw new AioncoreReleaseBundleError('AionCore bundle SHA256SUMS paths are not sorted.');
  }
  return checksums;
}

function validateChecksums(bundleDir, expectedPaths) {
  const checksums = parseChecksums(path.join(bundleDir, 'SHA256SUMS'));
  if (!isDeepStrictEqual([...checksums.keys()], expectedPaths)) {
    throw new AioncoreReleaseBundleError('AionCore bundle SHA256SUMS coverage does not match the bundle payload.');
  }
  for (const [relativePath, expectedDigest] of checksums) {
    const actualDigest = computeFileSha256(path.join(bundleDir, ...relativePath.split('/')));
    if (actualDigest !== expectedDigest) {
      throw new AioncoreReleaseBundleError(`AionCore bundle SHA256SUMS mismatch: ${relativePath}`);
    }
  }
}

function releaseBundleMetadataState(bundleDir) {
  const present = RELEASE_METADATA_FILES.filter((fileName) => {
    try {
      fs.lstatSync(path.join(bundleDir, fileName));
      return true;
    } catch {
      return false;
    }
  });
  if (present.length === 0) return 'absent';
  return present.length === RELEASE_METADATA_FILES.length ? 'complete' : 'partial';
}

/**
 * Verify the complete AionCore release bundle before WePrompt copies or executes it.
 */
function verifyAioncoreReleaseBundle({
  bundleDir,
  platform,
  arch,
  version,
  sourceCommit,
  repository,
  expectedLineage,
  allowedRuntimeKeys,
  allowDesktopManifest = false,
}) {
  const resolvedBundleDir = path.resolve(bundleDir);
  let rootStats;
  try {
    rootStats = fs.lstatSync(resolvedBundleDir);
  } catch {
    throw new AioncoreReleaseBundleError('AionCore bundle directory does not exist.');
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new AioncoreReleaseBundleError('AionCore bundle root must be a regular directory.');
  }

  if (repository !== AIONCORE_RELEASE_REPOSITORY) {
    throw new AioncoreReleaseBundleError('AionCore bundle requires the trusted release repository contract.');
  }
  if (expectedLineage === null || typeof expectedLineage !== 'object' || Array.isArray(expectedLineage)) {
    throw new AioncoreReleaseBundleError('AionCore bundle requires an explicit expected migration lineage.');
  }
  const runtimeKey = `${platform}-${arch}`;
  if (!Array.isArray(allowedRuntimeKeys) || !allowedRuntimeKeys.includes(runtimeKey)) {
    throw new AioncoreReleaseBundleError(
      `AionCore release target is not allowed by this bundle contract: ${runtimeKey}`
    );
  }
  const target = expectedReleaseTarget(platform, arch);
  if (!target) throw new AioncoreReleaseBundleError(`Unsupported AionCore release target: ${platform}-${arch}`);
  const expectedVersion = normalizeExpectedVersion(version);
  if (typeof sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new AioncoreReleaseBundleError('AionCore bundle requires an exact trusted source commit.');
  }

  const binaryName = platform === 'win32' ? 'aioncore.exe' : 'aioncore';
  assertExactTopLevelMembers(resolvedBundleDir, binaryName, allowDesktopManifest);
  const allFiles = listBundleFiles(resolvedBundleDir);
  assertRegularFile(path.join(resolvedBundleDir, binaryName), binaryName);
  assertRegularFile(path.join(resolvedBundleDir, 'migration-lineage.json'), 'migration-lineage.json');
  assertRegularFile(path.join(resolvedBundleDir, 'bundle-manifest.json'), 'bundle-manifest.json');
  assertRegularFile(path.join(resolvedBundleDir, 'SHA256SUMS'), 'SHA256SUMS');
  assertOfficeCli(resolvedBundleDir, platform);

  const manifest = readJsonObject(path.join(resolvedBundleDir, 'bundle-manifest.json'), 'bundle-manifest.json');
  validateManifest({
    bundleDir: resolvedBundleDir,
    manifest,
    repository,
    version: expectedVersion,
    sourceCommit,
    target,
    expectedLineage,
  });

  const excluded = new Set(['bundle-manifest.json', 'SHA256SUMS', ...(allowDesktopManifest ? ['manifest.json'] : [])]);
  const payloadPaths = allFiles.filter((relativePath) => !excluded.has(relativePath));
  validateManifestInventory(resolvedBundleDir, manifest, payloadPaths);
  validateChecksums(resolvedBundleDir, [...payloadPaths, 'bundle-manifest.json'].toSorted());
  return { manifest, target };
}

module.exports = {
  AIONCORE_RELEASE_REPOSITORY,
  AioncoreReleaseBundleError,
  expectedReleaseTarget,
  releaseBundleMetadataState,
  validateAioncoreReleaseBundleContract,
  verifyAioncoreReleaseBundle,
};
