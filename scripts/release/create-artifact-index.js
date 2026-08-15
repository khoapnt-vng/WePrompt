#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const PLATFORM_TARGETS = [
  ['windows-x64', 'x86_64-pc-windows-msvc'],
  ['macos-arm64', 'aarch64-apple-darwin'],
];
const ARTIFACT_KEYS = [
  'platform',
  'target',
  'name',
  'sha256',
  'wepromptCommit',
  'aioncoreVersion',
  'aioncoreCommit',
  'aioncoreBinarySha256',
  'bundleManifestSha256',
  'migrationLineageFingerprint',
  'internal',
  'unsigned',
  'creativeStudioEnabled',
  'autoUpdateEnabled',
  'sentryEnabled',
];

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} has invalid shape`);
  }
}

function validateArtifactIndex(index) {
  assertExactKeys(index, ['schemaVersion', 'state', 'artifacts'], 'artifact index');
  if (index.schemaVersion !== 1 || index.state !== 'held_not_approved') {
    throw new Error('artifact index must be schemaVersion 1 and held_not_approved');
  }
  if (!Array.isArray(index.artifacts) || index.artifacts.length !== 2) {
    throw new Error('artifact index requires exactly two artifacts');
  }
  const names = new Set();
  const hashes = new Set();
  let identity = null;
  index.artifacts.forEach((artifact, position) => {
    assertExactKeys(artifact, ARTIFACT_KEYS, `artifact ${position + 1}`);
    const [platform, target] = PLATFORM_TARGETS[position];
    if (artifact.platform !== platform || artifact.target !== target) {
      throw new Error('artifact index must list Windows x64 first, then macOS ARM64');
    }
    if (
      typeof artifact.name !== 'string' ||
      artifact.name.trim() === '' ||
      path.basename(artifact.name) !== artifact.name
    ) {
      throw new Error(`artifact ${position + 1} has invalid name`);
    }
    if (!SHA256.test(artifact.sha256 ?? '') || hashes.has(artifact.sha256)) {
      throw new Error('artifact hashes must be exact and unique');
    }
    if (names.has(artifact.name)) throw new Error('artifact names must be unique');
    names.add(artifact.name);
    hashes.add(artifact.sha256);
    if (!COMMIT.test(artifact.wepromptCommit ?? '') || !COMMIT.test(artifact.aioncoreCommit ?? '')) {
      throw new Error('artifact identities require exact commits');
    }
    if (artifact.aioncoreVersion !== 'v0.1.55' || !SHA256.test(artifact.migrationLineageFingerprint ?? '')) {
      throw new Error('artifact has invalid AionCore identity');
    }
    if (!SHA256.test(artifact.aioncoreBinarySha256 ?? '') || !SHA256.test(artifact.bundleManifestSha256 ?? '')) {
      throw new Error('artifact lacks exact embedded AionCore hashes');
    }
    for (const key of ['internal', 'unsigned']) {
      if (artifact[key] !== true) throw new Error(`${key} must be true`);
    }
    for (const key of ['creativeStudioEnabled', 'autoUpdateEnabled', 'sentryEnabled']) {
      if (artifact[key] !== false) throw new Error(`${key} must be false`);
    }
    const currentIdentity = JSON.stringify({
      wepromptCommit: artifact.wepromptCommit,
      aioncoreVersion: artifact.aioncoreVersion,
      aioncoreCommit: artifact.aioncoreCommit,
      migrationLineageFingerprint: artifact.migrationLineageFingerprint,
    });
    if (identity !== null && identity !== currentIdentity) throw new Error('artifacts do not share one RC and backend');
    identity = currentIdentity;
  });
  return index;
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 4 || argv[0] !== '--input' || argv[2] !== '--output') {
    throw new Error('usage: create-artifact-index.js --input <candidate.json> --output <artifact-index.json>');
  }
  const inputPath = path.resolve(argv[1]);
  const outputPath = path.resolve(argv[3]);
  const index = validateArtifactIndex(JSON.parse(fs.readFileSync(inputPath, 'utf8')));
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporaryPath, outputPath);
  process.stdout.write(`Created held artifact index: ${outputPath}\n`);
}

module.exports = { validateArtifactIndex };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`artifact index creation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
