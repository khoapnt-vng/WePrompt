import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const { createEvidenceIndex } = require('../../../scripts/release/create-evidence-index');
const { validateEvidenceIndex } = require('../../../scripts/release/validate-evidence-index');

const WEPROMPT_COMMIT = 'a'.repeat(40);
const AIONCORE_COMMIT = 'b'.repeat(40);
const LINEAGE_FINGERPRINT = 'c'.repeat(64);
const WINDOWS_ARTIFACT_SHA = '1'.repeat(64);
const MAC_ARTIFACT_SHA = '2'.repeat(64);
const EVIDENCE_SHA = '3'.repeat(64);

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

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function artifact(platform: 'windows-x64' | 'macos-arm64') {
  const windows = platform === 'windows-x64';
  return {
    platform,
    target: windows ? 'x86_64-pc-windows-msvc' : 'aarch64-apple-darwin',
    name: windows ? 'WePrompt-2.1.39-win-x64.exe' : 'WePrompt-2.1.39-mac-arm64.dmg',
    sha256: windows ? WINDOWS_ARTIFACT_SHA : MAC_ARTIFACT_SHA,
    wepromptCommit: WEPROMPT_COMMIT,
    aioncoreVersion: 'v0.1.55',
    aioncoreCommit: AIONCORE_COMMIT,
    aioncoreBinarySha256: windows ? '4'.repeat(64) : '5'.repeat(64),
    bundleManifestSha256: windows ? '6'.repeat(64) : '7'.repeat(64),
    migrationLineageFingerprint: LINEAGE_FINGERPRINT,
    internal: true,
    unsigned: true,
    creativeStudioEnabled: false,
    autoUpdateEnabled: false,
    sentryEnabled: false,
  };
}

function artifactIndex() {
  return {
    schemaVersion: 1,
    state: 'held_not_approved',
    artifacts: [artifact('windows-x64'), artifact('macos-arm64')],
  };
}

function result(id: string, status: 'pass' | 'fail' | 'blocked' = 'pass') {
  return {
    id,
    status,
    startedAt: '2026-08-16T01:00:00Z',
    endedAt: '2026-08-16T01:05:00Z',
    notes: status === 'pass' ? 'Observed the required packaged behavior.' : 'Stopped and preserved evidence.',
    evidence: [
      {
        kind: 'sanitized-log',
        path: `evidence/${id.toLowerCase()}.log`,
        sha256: EVIDENCE_SHA,
      },
    ],
    ...(status === 'pass'
      ? {}
      : {
          failure: {
            reason: status === 'blocked' ? 'Required runtime capability is not built.' : 'Observed behavior failed.',
            owner: 'WePrompt release owner',
            preservedFixture: {
              location: `controlled://sprint3/${id.toLowerCase()}`,
              sha256: '8'.repeat(64),
            },
          },
        }),
  };
}

function platformRecord(platform: 'windows-x64' | 'macos-arm64') {
  const indexed = artifact(platform);
  const windows = platform === 'windows-x64';
  return {
    platform,
    artifact: {
      name: indexed.name,
      sha256: indexed.sha256,
      wepromptCommit: indexed.wepromptCommit,
      aioncoreVersion: indexed.aioncoreVersion,
      aioncoreCommit: indexed.aioncoreCommit,
      aioncoreBinarySha256: indexed.aioncoreBinarySha256,
      bundleManifestSha256: indexed.bundleManifestSha256,
      migrationLineageFingerprint: indexed.migrationLineageFingerprint,
    },
    startedAt: '2026-08-16T00:00:00Z',
    endedAt: '2026-08-16T03:00:00Z',
    environment: {
      tester: windows ? 'Windows tester' : 'macOS tester',
      machine: windows ? 'clean-win-vm-01' : 'clean-mac-01',
      osBuild: windows ? 'Windows 11 24H2 build 26100' : 'macOS 15.6.1',
      filesystem: windows ? 'NTFS' : 'APFS',
      architecture: windows ? 'x64' : 'arm64',
      snapshotId: windows ? 'win-clean-snapshot-01' : 'mac-clean-snapshot-01',
      locale: 'en-US',
      timezone: 'UTC',
    },
    windowsGates: windows ? WINDOWS_GATE_IDS.map((id) => result(id)) : [],
    scenarios: SCENARIO_IDS.map((id) => {
      if (id !== 'S09_BUG017') return result(id);
      const bug017 = result(id, 'blocked');
      bug017.failure = {
        reason: 'Runtime classification and recovery UX are unbuilt; only the non-destructive safeguard is proven.',
        owner: 'WePrompt and AionCore owners',
        preservedFixture: {
          location: `controlled://sprint3/${platform}/bug017`,
          sha256: '9'.repeat(64),
        },
      };
      return bug017;
    }),
  };
}

function validEvidenceIndex() {
  const serializedArtifactIndex = `${JSON.stringify(artifactIndex(), null, 2)}\n`;
  return {
    schemaVersion: 1,
    releaseChannel: 'internal',
    artifactIndex: {
      path: 'docs/release/sprint3-internal/artifact-index.json',
      sha256: sha256(serializedArtifactIndex),
    },
    decisionReadiness: 'ready_for_owner_decision',
    bug017RuntimeRecoveryBuilt: false,
    platforms: [platformRecord('windows-x64'), platformRecord('macos-arm64')],
  };
}

describe('Sprint 3 evidence index validation', () => {
  it('accepts a Windows-first packet whose only blocked scenario is explicit BUG-017 residual risk', () => {
    expect(validateEvidenceIndex(validEvidenceIndex(), artifactIndex())).toEqual(validEvidenceIndex());
  });

  it('requires every duplicated artifact identity to match the held artifact index', () => {
    const index = validEvidenceIndex();
    index.platforms[1]!.artifact.aioncoreCommit = 'd'.repeat(40);
    expect(() => validateEvidenceIndex(index, artifactIndex())).toThrow(/artifact identity mismatch.*macos-arm64/i);

    const hashMismatch = validEvidenceIndex();
    hashMismatch.artifactIndex.sha256 = 'f'.repeat(64);
    expect(() => validateEvidenceIndex(hashMismatch, artifactIndex())).toThrow(/artifact index hash mismatch/i);
  });

  it('requires a packet-relative artifact index path', () => {
    for (const unsafePath of ['/tmp/artifact-index.json', '../artifact-index.json']) {
      const index = validEvidenceIndex();
      index.artifactIndex.path = unsafePath;
      expect(() => validateEvidenceIndex(index, artifactIndex())).toThrow(/artifact index path/i);
    }
  });

  it('requires exactly Windows x64 then macOS ARM64 and every scenario exactly once', () => {
    const reversed = validEvidenceIndex();
    reversed.platforms.reverse();
    expect(() => validateEvidenceIndex(reversed, artifactIndex())).toThrow(/Windows.*first/i);

    const missing = validEvidenceIndex();
    missing.platforms[0]!.scenarios.pop();
    expect(() => validateEvidenceIndex(missing, artifactIndex())).toThrow(/scenario set/i);

    const duplicate = validEvidenceIndex();
    duplicate.platforms[1]!.scenarios[11] = duplicate.platforms[1]!.scenarios[0]!;
    expect(() => validateEvidenceIndex(duplicate, artifactIndex())).toThrow(/scenario set/i);
  });

  it('rejects skipped-like status, invalid time order, incomplete environments, and unhashed evidence', () => {
    const skipped = validEvidenceIndex();
    Object.assign(skipped.platforms[0]!.scenarios[0]!, { status: 'skipped' });
    expect(() => validateEvidenceIndex(skipped, artifactIndex())).toThrow(/status/i);

    const badTime = validEvidenceIndex();
    badTime.platforms[0]!.scenarios[0]!.endedAt = '2026-08-15T00:00:00Z';
    expect(() => validateEvidenceIndex(badTime, artifactIndex())).toThrow(/time order/i);

    const noFilesystem = validEvidenceIndex();
    noFilesystem.platforms[0]!.environment.filesystem = '';
    expect(() => validateEvidenceIndex(noFilesystem, artifactIndex())).toThrow(/filesystem/i);

    const noHash = validEvidenceIndex();
    noHash.platforms[1]!.scenarios[0]!.evidence[0]!.sha256 = '';
    expect(() => validateEvidenceIndex(noHash, artifactIndex())).toThrow(/evidence hash/i);
  });

  it('requires bounded notes and preserved failure details for every fail or blocked result', () => {
    const noFailure = validEvidenceIndex();
    delete noFailure.platforms[0]!.scenarios[8]!.failure;
    expect(() => validateEvidenceIndex(noFailure, artifactIndex())).toThrow(/failure details/i);

    const longNotes = validEvidenceIndex();
    longNotes.platforms[0]!.windowsGates[0]!.notes = 'x'.repeat(1001);
    expect(() => validateEvidenceIndex(longNotes, artifactIndex())).toThrow(/bounded notes/i);

    const noFixtureHash = validEvidenceIndex();
    noFixtureHash.platforms[1]!.scenarios[8]!.failure!.preservedFixture.sha256 = '';
    expect(() => validateEvidenceIndex(noFixtureHash, artifactIndex())).toThrow(/preserved fixture hash/i);
  });

  it('rejects secret-bearing fields, token-like values, and user-home paths anywhere in the packet', () => {
    const secretField = validEvidenceIndex() as ReturnType<typeof validEvidenceIndex> & { refreshToken?: string };
    secretField.refreshToken = 'must-not-appear';
    expect(() => validateEvidenceIndex(secretField, artifactIndex())).toThrow(/secret-like field/i);

    const bearer = validEvidenceIndex();
    bearer.platforms[0]!.scenarios[3]!.notes = 'Authorization observed: Bearer abcdefghijklmnop';
    expect(() => validateEvidenceIndex(bearer, artifactIndex())).toThrow(/secret-like value/i);

    const userPath = validEvidenceIndex();
    userPath.platforms[1]!.scenarios[0]!.evidence[0]!.path = '/Users/alice/private/release.log';
    expect(() => validateEvidenceIndex(userPath, artifactIndex())).toThrow(/user path/i);
  });

  it('never permits decision-ready status before all four native Windows entry gates pass', () => {
    for (const status of ['fail', 'blocked'] as const) {
      const index = validEvidenceIndex();
      index.platforms[0]!.windowsGates[1] = result('W02_BUG043_FILESYSTEM', status);
      expect(() => validateEvidenceIndex(index, artifactIndex())).toThrow(/Windows entry gates.*pass/i);
    }
  });

  it('forbids BUG-017 pass while runtime classification and recovery remain unbuilt', () => {
    const index = validEvidenceIndex();
    index.platforms[0]!.scenarios[8] = result('S09_BUG017');
    expect(() => validateEvidenceIndex(index, artifactIndex())).toThrow(/BUG-017.*cannot pass/i);
  });

  it('requires BUG-017 to pass before decision-ready status when runtime recovery is built', () => {
    const index = validEvidenceIndex();
    index.bug017RuntimeRecoveryBuilt = true;
    expect(() => validateEvidenceIndex(index, artifactIndex())).toThrow(/unresolved.*S09_BUG017/i);
  });

  it('creates the immutable identity envelope from the held artifact index rather than caller overrides', () => {
    const platformRecords = [platformRecord('windows-x64'), platformRecord('macos-arm64')];
    for (const record of platformRecords) record.artifact.wepromptCommit = 'f'.repeat(40);

    const created = createEvidenceIndex({
      artifactIndexPath: 'docs/release/sprint3-internal/artifact-index.json',
      artifactIndex: artifactIndex(),
      decisionReadiness: 'ready_for_owner_decision',
      bug017RuntimeRecoveryBuilt: false,
      platformRecords,
    });

    expect(
      created.platforms.map((record: { artifact: { wepromptCommit: string } }) => record.artifact.wepromptCommit)
    ).toEqual([WEPROMPT_COMMIT, WEPROMPT_COMMIT]);
    expect(() => validateEvidenceIndex(created, artifactIndex())).not.toThrow();
  });

  it('keeps the checked-in valid fixture executable through the same validator', () => {
    const fixtureArtifactIndex = JSON.parse(readFileSync('tests/fixtures/release/artifact-index-valid.json', 'utf8'));
    const fixtureEvidenceIndex = JSON.parse(readFileSync('tests/fixtures/release/evidence-index-valid.json', 'utf8'));
    expect(() => validateEvidenceIndex(fixtureEvidenceIndex, fixtureArtifactIndex)).not.toThrow();
  });
});
