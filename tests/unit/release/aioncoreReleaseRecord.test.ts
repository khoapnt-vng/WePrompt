import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const { validateAioncoreReleaseRecord } = require('../../../scripts/release/validate-aioncore-release-record.js');

const temporaryDirectories: string[] = [];

function validRecord() {
  return {
    schemaVersion: 1,
    repository: 'khoapnt-vng/aioncore',
    version: 'v0.1.55',
    tagCommit: '1'.repeat(40),
    migrationLineageFingerprint: '2'.repeat(64),
    assets: [
      {
        target: 'aarch64-apple-darwin',
        name: 'aioncore-v0.1.55-aarch64-apple-darwin.tar.gz',
        sha256: '3'.repeat(64),
        binarySha256: '4'.repeat(64),
        bundleManifestSha256: '5'.repeat(64),
      },
      {
        target: 'x86_64-pc-windows-msvc',
        name: 'aioncore-v0.1.55-x86_64-pc-windows-msvc.zip',
        sha256: '6'.repeat(64),
        binarySha256: '7'.repeat(64),
        bundleManifestSha256: '8'.repeat(64),
      },
    ],
  };
}

function writeRecord(record: unknown) {
  const directory = mkdtempSync(join(tmpdir(), 'weprompt-aioncore-record-'));
  temporaryDirectories.push(directory);
  const recordPath = join(directory, 'record.json');
  writeFileSync(recordPath, `${JSON.stringify(record)}\n`);
  return recordPath;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('AionCore v0.1.55 release record validation', () => {
  it('accepts one exact record for each approved target', () => {
    expect(validateAioncoreReleaseRecord(validRecord())).toEqual([]);
  });

  it('rejects missing required fields with field-specific errors', () => {
    const { repository: _repository, ...record } = validRecord();

    expect(validateAioncoreReleaseRecord(record)).toContain('repository is required');
  });

  it('rejects the wrong repository and version', () => {
    const record = { ...validRecord(), repository: 'iOfficeAI/AionCore', version: 'v0.1.54' };

    expect(validateAioncoreReleaseRecord(record)).toEqual([
      'repository must equal khoapnt-vng/aioncore',
      'version must equal v0.1.55',
    ]);
  });

  it('rejects uppercase and short commit or digest values', () => {
    const record = validRecord();
    record.tagCommit = 'A'.repeat(40);
    record.assets[0].sha256 = 'a'.repeat(63);

    expect(validateAioncoreReleaseRecord(record)).toEqual([
      'tagCommit must be 40 lowercase hexadecimal characters',
      'assets[0].sha256 must be 64 lowercase hexadecimal characters',
    ]);
  });

  it('rejects duplicate and unapproved targets', () => {
    const duplicate = validRecord();
    duplicate.assets[1].target = 'aarch64-apple-darwin';
    const extra = validRecord();
    extra.assets.push({
      ...extra.assets[0],
      target: 'x86_64-apple-darwin',
      name: 'aioncore-v0.1.55-x86_64-apple-darwin.tar.gz',
    });

    expect(validateAioncoreReleaseRecord(duplicate)).toContain(
      'assets must contain exactly one record for each approved target'
    );
    expect(validateAioncoreReleaseRecord(extra)).toContain('assets must contain exactly two target records');
  });

  it('rejects duplicate asset names', () => {
    const record = validRecord();
    record.assets[1].name = record.assets[0].name;

    expect(validateAioncoreReleaseRecord(record)).toContain('asset names must be unique');
  });

  it('rejects unknown root and asset properties', () => {
    const record = {
      ...validRecord(),
      mutableDownloadUrl: 'https://example.invalid/latest',
    };
    record.assets[0] = { ...record.assets[0], branch: 'main' } as (typeof record.assets)[number];

    expect(validateAioncoreReleaseRecord(record)).toEqual([
      'unexpected root property: mutableDownloadUrl',
      'unexpected property in assets[0]: branch',
    ]);
  });

  it('returns a nonzero CLI exit for an invalid record', () => {
    const script = resolve('scripts/release/validate-aioncore-release-record.js');
    const result = spawnSync(process.execPath, [script, writeRecord({ schemaVersion: 1 })], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('repository is required');
  });
});
