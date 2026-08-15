#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validateArtifactIndex } = require('./create-artifact-index');
const { validateEvidenceIndex } = require('./validate-evidence-index');

function artifactIdentity(artifact) {
  return {
    name: artifact.name,
    sha256: artifact.sha256,
    wepromptCommit: artifact.wepromptCommit,
    aioncoreVersion: artifact.aioncoreVersion,
    aioncoreCommit: artifact.aioncoreCommit,
    aioncoreBinarySha256: artifact.aioncoreBinarySha256,
    bundleManifestSha256: artifact.bundleManifestSha256,
    migrationLineageFingerprint: artifact.migrationLineageFingerprint,
  };
}

function createEvidenceIndex({
  artifactIndexPath,
  artifactIndex,
  decisionReadiness,
  bug017RuntimeRecoveryBuilt,
  platformRecords,
}) {
  validateArtifactIndex(artifactIndex);
  if (!Array.isArray(platformRecords)) throw new Error('platformRecords must be an array');
  const recordsByPlatform = new Map(platformRecords.map((record) => [record.platform, record]));
  const platforms = artifactIndex.artifacts.map((artifact) => {
    const record = recordsByPlatform.get(artifact.platform);
    if (!record) throw new Error(`missing platform record: ${artifact.platform}`);
    return { ...structuredClone(record), artifact: artifactIdentity(artifact) };
  });
  const artifactBytes = `${JSON.stringify(artifactIndex, null, 2)}\n`;
  const index = {
    schemaVersion: 1,
    releaseChannel: 'internal',
    artifactIndex: {
      path: artifactIndexPath,
      sha256: crypto.createHash('sha256').update(artifactBytes).digest('hex'),
    },
    decisionReadiness,
    bug017RuntimeRecoveryBuilt,
    platforms,
  };
  return validateEvidenceIndex(index, artifactIndex);
}

function parseArgs(argv) {
  if (argv.length !== 10) {
    throw new Error(
      'usage: create-evidence-index.js --artifact-index <json> --platform-records <json> --decision-readiness <state> --bug017-runtime-recovery-built <true|false> --output <json>'
    );
  }
  const options = {};
  for (let index = 0; index < argv.length; index += 2) options[argv[index]] = argv[index + 1];
  for (const key of [
    '--artifact-index',
    '--platform-records',
    '--decision-readiness',
    '--bug017-runtime-recovery-built',
    '--output',
  ]) {
    if (!options[key]) throw new Error(`missing ${key}`);
  }
  if (!['true', 'false'].includes(options['--bug017-runtime-recovery-built'])) {
    throw new Error('--bug017-runtime-recovery-built must be true or false');
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const artifactPath = path.resolve(options['--artifact-index']);
  const platformRecordsPath = path.resolve(options['--platform-records']);
  const outputPath = path.resolve(options['--output']);
  const index = createEvidenceIndex({
    artifactIndexPath: path.relative(process.cwd(), artifactPath).split(path.sep).join('/'),
    artifactIndex: JSON.parse(fs.readFileSync(artifactPath, 'utf8')),
    decisionReadiness: options['--decision-readiness'],
    bug017RuntimeRecoveryBuilt: options['--bug017-runtime-recovery-built'] === 'true',
    platformRecords: JSON.parse(fs.readFileSync(platformRecordsPath, 'utf8')),
  });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporaryPath, outputPath);
  process.stdout.write(`Created Sprint 3 evidence index: ${outputPath}\n`);
}

module.exports = { createEvidenceIndex };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`evidence index creation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
