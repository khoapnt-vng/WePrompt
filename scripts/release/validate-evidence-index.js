#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SHA256 = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SCENARIO_IDS = [
  'S01_INSTALL',
  'S02_SPRINT2_MIGRATION',
  'S03_LINEAGE_FAIL_CLOSED',
  'S04_HTTP_WS_AUTH',
  'S05_MCP_OAUTH_TOOL',
  'S06_OAUTH_EXPIRY',
  'S07_OFFICECLI',
  'S08_PRESENTATION_TEMPLATES',
  'S09_BUG017',
  'S10_RESTART',
  'S11_STUDIO_ABSENT',
  'S12_UPDATE_ABSENT',
];
const WINDOWS_GATE_IDS = [
  'W01_NATIVE_SOURCE',
  'W02_BUG043_FILESYSTEM',
  'W03_BUG043_PACKAGED_FAIL_CLOSED',
  'W04_INSTALLED_BUNDLE',
];
const SECRET_FIELD = /(?:token|password|secret|authorization|cookie|credential)/i;
const SECRET_VALUE =
  /(?:Bearer\s+[A-Za-z0-9._~+/-]{8,}|\bgh[opsu]_[A-Za-z0-9]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.)/i;
const USER_PATH = /(?:^|[\s"'])(?:\/Users\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)/;

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} has invalid shape`);
  }
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`);
}

function scanSecrets(value, location = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanSecrets(entry, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      if (SECRET_VALUE.test(value)) throw new Error(`secret-like value at ${location}`);
      if (USER_PATH.test(value)) throw new Error(`user path at ${location}`);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) throw new Error(`secret-like field at ${location}.${key}`);
    scanSecrets(entry, `${location}.${key}`);
  }
}

function validateTimeRange(startedAt, endedAt, label) {
  if (!UTC.test(startedAt ?? '') || !UTC.test(endedAt ?? '')) throw new Error(`${label} requires UTC timestamps`);
  if (Date.parse(endedAt) < Date.parse(startedAt)) throw new Error(`${label} has invalid time order`);
}

function validateEvidence(evidence, label) {
  if (!Array.isArray(evidence) || evidence.length === 0) throw new Error(`${label} requires evidence`);
  const paths = new Set();
  for (const [index, item] of evidence.entries()) {
    exactKeys(item, ['kind', 'path', 'sha256'], `${label} evidence ${index + 1}`);
    requiredString(item.kind, `${label} evidence kind`);
    requiredString(item.path, `${label} evidence path`);
    if (path.posix.isAbsolute(item.path) || item.path.split('/').includes('..') || paths.has(item.path)) {
      throw new Error(`${label} evidence path must be unique and packet-relative`);
    }
    if (!SHA256.test(item.sha256 ?? '')) throw new Error(`${label} evidence hash is invalid`);
    paths.add(item.path);
  }
}

function validateResult(record, expectedId, label) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`${label} must be an object`);
  if (record.id !== expectedId) throw new Error(`${label} id mismatch`);
  if (!['pass', 'fail', 'blocked'].includes(record.status)) throw new Error(`${label} has invalid status`);
  const pass = record?.status === 'pass';
  if (!pass && (!record.failure || typeof record.failure !== 'object')) {
    throw new Error(`${label} requires failure details`);
  }
  exactKeys(
    record,
    pass
      ? ['id', 'status', 'startedAt', 'endedAt', 'notes', 'evidence']
      : ['id', 'status', 'startedAt', 'endedAt', 'notes', 'evidence', 'failure'],
    label
  );
  validateTimeRange(record.startedAt, record.endedAt, label);
  if (typeof record.notes !== 'string' || record.notes.length > 1000)
    throw new Error(`${label} requires bounded notes`);
  validateEvidence(record.evidence, label);
  if (pass) return;
  exactKeys(record.failure, ['reason', 'owner', 'preservedFixture'], `${label} failure details`);
  requiredString(record.failure.reason, `${label} failure reason`);
  requiredString(record.failure.owner, `${label} failure owner`);
  exactKeys(record.failure.preservedFixture, ['location', 'sha256'], `${label} preserved fixture`);
  requiredString(record.failure.preservedFixture.location, `${label} preserved fixture location`);
  if (!SHA256.test(record.failure.preservedFixture.sha256 ?? '')) {
    throw new Error(`${label} preserved fixture hash is invalid`);
  }
}

function validateEnvironment(environment, platform) {
  const fields = ['tester', 'machine', 'osBuild', 'filesystem', 'architecture', 'snapshotId', 'locale', 'timezone'];
  exactKeys(environment, fields, `${platform} environment`);
  for (const field of fields) requiredString(environment[field], `${platform} environment ${field}`);
  const expectedArchitecture = platform === 'windows-x64' ? 'x64' : 'arm64';
  if (environment.architecture !== expectedArchitecture)
    throw new Error(`${platform} environment architecture mismatch`);
}

function validateArtifactIdentity(actual, expected, platform) {
  const fields = [
    'name',
    'sha256',
    'wepromptCommit',
    'aioncoreVersion',
    'aioncoreCommit',
    'aioncoreBinarySha256',
    'bundleManifestSha256',
    'migrationLineageFingerprint',
  ];
  exactKeys(actual, fields, `${platform} artifact identity`);
  for (const field of fields) {
    if (actual[field] !== expected[field]) throw new Error(`artifact identity mismatch for ${platform}: ${field}`);
  }
}

function validatePlatform(record, expectedPlatform, expectedArtifact) {
  exactKeys(
    record,
    ['platform', 'artifact', 'startedAt', 'endedAt', 'environment', 'windowsGates', 'scenarios'],
    `${expectedPlatform} record`
  );
  if (record.platform !== expectedPlatform) throw new Error('Windows x64 must be first, followed by macOS ARM64');
  validateArtifactIdentity(record.artifact, expectedArtifact, expectedPlatform);
  validateTimeRange(record.startedAt, record.endedAt, `${expectedPlatform} acceptance`);
  validateEnvironment(record.environment, expectedPlatform);

  const expectedGates = expectedPlatform === 'windows-x64' ? WINDOWS_GATE_IDS : [];
  if (!Array.isArray(record.windowsGates) || record.windowsGates.length !== expectedGates.length) {
    throw new Error(`${expectedPlatform} Windows gate set is invalid`);
  }
  record.windowsGates.forEach((gate, index) =>
    validateResult(gate, expectedGates[index], `${expectedPlatform} gate ${expectedGates[index]}`)
  );

  if (
    !Array.isArray(record.scenarios) ||
    record.scenarios.length !== SCENARIO_IDS.length ||
    JSON.stringify(record.scenarios.map((scenario) => scenario.id)) !== JSON.stringify(SCENARIO_IDS)
  ) {
    throw new Error(`${expectedPlatform} scenario set is invalid`);
  }
  record.scenarios.forEach((scenario, index) =>
    validateResult(scenario, SCENARIO_IDS[index], `${expectedPlatform} scenario ${SCENARIO_IDS[index]}`)
  );
}

function validateEvidenceIndex(index, artifactIndex) {
  scanSecrets(index);
  exactKeys(
    index,
    [
      'schemaVersion',
      'releaseChannel',
      'artifactIndex',
      'decisionReadiness',
      'bug017RuntimeRecoveryBuilt',
      'platforms',
    ],
    'evidence index'
  );
  if (index.schemaVersion !== 1 || index.releaseChannel !== 'internal') {
    throw new Error('evidence index must be schemaVersion 1 for the internal channel');
  }
  exactKeys(index.artifactIndex, ['path', 'sha256'], 'artifact index reference');
  requiredString(index.artifactIndex.path, 'artifact index path');
  if (
    path.posix.isAbsolute(index.artifactIndex.path) ||
    path.win32.isAbsolute(index.artifactIndex.path) ||
    index.artifactIndex.path.includes('\\') ||
    index.artifactIndex.path.split('/').includes('..') ||
    path.posix.extname(index.artifactIndex.path) !== '.json'
  ) {
    throw new Error('artifact index path must be a packet-relative JSON path');
  }
  if (!SHA256.test(index.artifactIndex.sha256 ?? '')) throw new Error('artifact index reference hash is invalid');
  const artifactBytes = Buffer.from(`${JSON.stringify(artifactIndex, null, 2)}\n`);
  if (sha256Bytes(artifactBytes) !== index.artifactIndex.sha256) throw new Error('artifact index hash mismatch');
  if (!['not_ready', 'ready_for_owner_decision'].includes(index.decisionReadiness)) {
    throw new Error('invalid decisionReadiness');
  }
  if (typeof index.bug017RuntimeRecoveryBuilt !== 'boolean') throw new Error('BUG-017 runtime state must be explicit');
  if (!Array.isArray(artifactIndex?.artifacts) || artifactIndex.artifacts.length !== 2) {
    throw new Error('held artifact index must contain exactly two artifacts');
  }
  if (!Array.isArray(index.platforms) || index.platforms.length !== 2) {
    throw new Error('evidence index requires exactly two platform records with Windows first');
  }
  validatePlatform(index.platforms[0], 'windows-x64', artifactIndex.artifacts[0]);
  validatePlatform(index.platforms[1], 'macos-arm64', artifactIndex.artifacts[1]);

  for (const platform of index.platforms) {
    const bug017 = platform.scenarios.find((scenario) => scenario.id === 'S09_BUG017');
    if (!index.bug017RuntimeRecoveryBuilt && bug017?.status === 'pass') {
      throw new Error('BUG-017 cannot pass while runtime classification and recovery are unbuilt');
    }
  }

  if (index.decisionReadiness === 'ready_for_owner_decision') {
    if (index.platforms[0].windowsGates.some((gate) => gate.status !== 'pass')) {
      throw new Error('All Windows entry gates must pass before decision-ready status');
    }
    for (const platform of index.platforms) {
      for (const scenario of platform.scenarios) {
        const permittedBug017Block =
          !index.bug017RuntimeRecoveryBuilt && scenario.id === 'S09_BUG017' && scenario.status === 'blocked';
        if (scenario.status !== 'pass' && !permittedBug017Block) {
          throw new Error(`decision-ready packet contains unresolved ${platform.platform} ${scenario.id}`);
        }
      }
    }
  }
  return index;
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) throw new Error('usage: validate-evidence-index.js <evidence-index.json>');
  const evidencePath = path.resolve(argv[0]);
  const index = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const artifactPath = path.resolve(process.cwd(), index.artifactIndex?.path ?? '');
  const artifactIndex = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  validateEvidenceIndex(index, artifactIndex);
  process.stdout.write(`Valid Sprint 3 evidence index: ${index.decisionReadiness}\n`);
}

module.exports = { SCENARIO_IDS, WINDOWS_GATE_IDS, validateEvidenceIndex };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`evidence index validation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
