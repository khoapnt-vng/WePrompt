#!/usr/bin/env node

const fs = require('node:fs');

const APPROVED_REPOSITORY = 'khoapnt-vng/aioncore';
const APPROVED_VERSION = 'v0.1.55';
const APPROVED_TARGETS = new Set(['aarch64-apple-darwin', 'x86_64-pc-windows-msvc']);
const ROOT_PROPERTIES = [
  'schemaVersion',
  'repository',
  'version',
  'tagCommit',
  'migrationLineageFingerprint',
  'assets',
];
const ASSET_PROPERTIES = ['target', 'name', 'sha256', 'binarySha256', 'bundleManifestSha256'];
const LOWER_HEX_40 = /^[0-9a-f]{40}$/;
const LOWER_HEX_64 = /^[0-9a-f]{64}$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function validateRequiredProperties(record, properties, prefix, errors) {
  for (const property of properties) {
    if (!hasOwn(record, property)) {
      errors.push(`${prefix}${property} is required`);
    }
  }
}

function validateUnexpectedProperties(record, properties, messagePrefix, errors) {
  const allowed = new Set(properties);
  for (const property of Object.keys(record)
    .filter((key) => !allowed.has(key))
    .sort()) {
    errors.push(`${messagePrefix}${property}`);
  }
}

function validateAsset(asset, index, errors) {
  const prefix = `assets[${index}].`;
  if (!isRecord(asset)) {
    errors.push(`assets[${index}] must be an object`);
    return;
  }

  validateRequiredProperties(asset, ASSET_PROPERTIES, prefix, errors);
  validateUnexpectedProperties(asset, ASSET_PROPERTIES, `unexpected property in assets[${index}]: `, errors);

  if (hasOwn(asset, 'target') && !APPROVED_TARGETS.has(asset.target)) {
    errors.push(`${prefix}target is not an approved release target`);
  }
  if (hasOwn(asset, 'name') && (typeof asset.name !== 'string' || asset.name.length === 0)) {
    errors.push(`${prefix}name must be a non-empty string`);
  }
  for (const property of ['sha256', 'binarySha256', 'bundleManifestSha256']) {
    if (hasOwn(asset, property) && !LOWER_HEX_64.test(asset[property])) {
      errors.push(`${prefix}${property} must be 64 lowercase hexadecimal characters`);
    }
  }
}

function validateAioncoreReleaseRecord(record) {
  if (!isRecord(record)) {
    return ['release record must be an object'];
  }

  const errors = [];
  validateRequiredProperties(record, ROOT_PROPERTIES, '', errors);
  validateUnexpectedProperties(record, ROOT_PROPERTIES, 'unexpected root property: ', errors);

  if (hasOwn(record, 'schemaVersion') && record.schemaVersion !== 1) {
    errors.push('schemaVersion must equal 1');
  }
  if (hasOwn(record, 'repository') && record.repository !== APPROVED_REPOSITORY) {
    errors.push(`repository must equal ${APPROVED_REPOSITORY}`);
  }
  if (hasOwn(record, 'version') && record.version !== APPROVED_VERSION) {
    errors.push(`version must equal ${APPROVED_VERSION}`);
  }
  if (hasOwn(record, 'tagCommit') && !LOWER_HEX_40.test(record.tagCommit)) {
    errors.push('tagCommit must be 40 lowercase hexadecimal characters');
  }
  if (hasOwn(record, 'migrationLineageFingerprint') && !LOWER_HEX_64.test(record.migrationLineageFingerprint)) {
    errors.push('migrationLineageFingerprint must be 64 lowercase hexadecimal characters');
  }

  if (hasOwn(record, 'assets')) {
    if (!Array.isArray(record.assets)) {
      errors.push('assets must be an array');
    } else {
      if (record.assets.length !== 2) {
        errors.push('assets must contain exactly two target records');
      }
      record.assets.forEach((asset, index) => validateAsset(asset, index, errors));

      const targetCounts = new Map();
      const names = [];
      for (const asset of record.assets) {
        if (!isRecord(asset)) continue;
        targetCounts.set(asset.target, (targetCounts.get(asset.target) || 0) + 1);
        if (typeof asset.name === 'string') names.push(asset.name);
      }
      if ([...APPROVED_TARGETS].some((target) => targetCounts.get(target) !== 1)) {
        errors.push('assets must contain exactly one record for each approved target');
      }
      if (new Set(names).size !== names.length) {
        errors.push('asset names must be unique');
      }
    }
  }

  return errors;
}

function runCli(argv = process.argv.slice(2)) {
  if (argv.length !== 1) {
    console.error('usage: validate-aioncore-release-record.js <record.json>');
    return 2;
  }

  let record;
  try {
    record = JSON.parse(fs.readFileSync(argv[0], 'utf8'));
  } catch (error) {
    console.error(`invalid AionCore release record JSON: ${error.message}`);
    return 1;
  }

  const errors = validateAioncoreReleaseRecord(record);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    return 1;
  }
  return 0;
}

if (require.main === module) {
  process.exitCode = runCli();
}

module.exports = { validateAioncoreReleaseRecord, runCli };
