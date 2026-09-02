import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

const {
  ACCEPTED_AIONCORE_SOURCE_COMMIT,
  ACCEPTED_AIONCORE_TAG,
  ACCEPTED_AIONCORE_TAG_OBJECT,
  assertAcceptedAioncoreReleaseTag,
  assertAcceptedActionsRun,
  getActionsArtifactName,
  getActionsArtifactMissingMessage,
  prepareAioncore,
} = require('../../../packages/shared-scripts/src/prepare-aioncore');
const { acceptedMigrationLineage } = require('../../../packages/shared-scripts/src/verify-bundled-aioncore-resources');

const posixFakeToolchainIt = process.platform === 'win32' ? it.skip : it;

/**
 * These four cases build a fake POSIX toolchain on disk and run the real resolver over it.
 * Measured in isolation on a quiet machine: 4.7s, 3.5s, 6.4s and 6.3s — the other twelve cases
 * in this file take under a millisecond. The 10s global testTimeout leaves too little headroom
 * to survive full-suite parallelism, where all four exceeded it reproducibly (2 runs of 2).
 *
 * 30s was tried first and was still not enough: the 6.4s case exceeded it once in three
 * full-suite runs. These cases are I/O bound, so a generous ceiling costs nothing and only
 * prevents false failures — the assertions are untouched by it. Do not lower this back toward
 * the global default without re-measuring under full-suite load.
 */
const FAKE_TOOLCHAIN_TIMEOUT_MS = 120_000;
const publishedAioncoreRefs =
  'e2aa0db0f1129c6cf5e6b9856ffafaa60c66491b\trefs/tags/v0.1.55\n' +
  'ef6e1dd199e884fdf2df95d494b2c51b97006656\trefs/tags/v0.1.55^{}\n';
const resolvePublishedAioncoreRefs = () => publishedAioncoreRefs;

function legacyFixtureContract(allowedRuntimeKeys = ['linux-x64']) {
  return {
    repository: 'khoapnt-vng/aioncore',
    expectedSourceCommit: ACCEPTED_AIONCORE_SOURCE_COMMIT,
    expectedLineage: acceptedMigrationLineage,
    allowedRuntimeKeys,
    requireCompleteBundle: false,
  };
}

function writeFile(filePath: string, contents = 'x') {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writeExecutable(filePath: string, contents: string) {
  writeFile(filePath, contents);
  chmodSync(filePath, 0o755);
}

function createFakeToolchain(root: string, { curlFails = false } = {}) {
  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });

  writeExecutable(
    join(binDir, 'curl'),
    curlFails
      ? '#!/usr/bin/env bash\nexit 1\n'
      : `#!/usr/bin/env bash
set -euo pipefail
out=''
while [[ $# -gt 0 ]]; do
  if [[ "$1" == '-o' ]]; then
    shift
    out="$1"
  fi
  shift || true
done
if [[ -z "$out" ]]; then
  printf '{}'
  exit 0
fi
mkdir -p "$(dirname "$out")"
printf 'archive' > "$out"
`
  );
  writeExecutable(join(binDir, 'wget'), '#!/usr/bin/env bash\nexit 1\n');
  writeExecutable(
    join(binDir, 'gh'),
    `#!/usr/bin/env bash
if [[ "$*" != *'/artifacts?per_page=100'* ]]; then
  cat <<'JSON'
{"status":"completed","conclusion":"success","head_sha":"${ACCEPTED_AIONCORE_SOURCE_COMMIT}"}
JSON
  exit 0
fi
cat <<'JSON'
{"artifacts":[{"id":123,"name":"aioncore-manual-linux-x64","archive_download_url":"https://example.invalid/artifact.zip"}]}
JSON
`
  );
  writeExecutable(
    join(binDir, 'unzip'),
    `#!/usr/bin/env bash
set -euo pipefail
out=''
while [[ $# -gt 0 ]]; do
  if [[ "$1" == '-d' ]]; then
    shift
    out="$1"
  fi
  shift || true
done
mkdir -p "$out"
printf 'archive' > "$out/aioncore-v0.1.46-x86_64-unknown-linux-gnu.tar.gz"
`
  );
  writeExecutable(
    join(binDir, 'tar'),
    `#!/usr/bin/env bash
set -euo pipefail
out=''
while [[ $# -gt 0 ]]; do
  if [[ "$1" == '-C' ]]; then
    shift
    out="$1"
  fi
  shift || true
done
mkdir -p "$out"
cat > "$out/aioncore" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$out/aioncore"
cat > "$out/migration-lineage.json" <<'JSON'
${JSON.stringify(acceptedMigrationLineage, null, 2)}
JSON
`
  );

  return binDir;
}

/**
 * `prepare-aioncore.js` puts its scratch dirs at `os.tmpdir()/aioncore-prepare/<tag>` and
 * `os.tmpdir()/aioncore-prepare-actions/<runId>`. Nothing in either path is per-process, and these
 * tests pin the tag and the run id, so every test run on the machine — including runs in other
 * worktrees, since `os.tmpdir()` is machine-global — used to share one directory and delete it out
 * from under the others on cleanup. `os.tmpdir()` reads TMPDIR on each call, so pointing it at the
 * test's own scratch root makes those paths private and lets the tests run concurrently.
 */
function useIsolatedTmpdir(root: string): () => void {
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = root;
  return () => {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
  };
}

afterEach(() => {
  delete process.env.AIONUI_BACKEND_RUN_ID;
  delete process.env.AIONUI_BACKEND_LOCAL_BINARY;
  delete process.env.AIONUI_BACKEND_LOCAL_LINEAGE;
});

describe('prepare-aioncore GitHub Actions artifact resolver', () => {
  it('accepts the exact published annotated release tag', () => {
    expect(() => assertAcceptedAioncoreReleaseTag(ACCEPTED_AIONCORE_TAG, resolvePublishedAioncoreRefs)).not.toThrow();
    expect(ACCEPTED_AIONCORE_TAG_OBJECT).toBe('e2aa0db0f1129c6cf5e6b9856ffafaa60c66491b');
  });

  it('classifies a recreated release tag as a fail-closed integrity error', () => {
    let failure: (Error & { isAioncoreIntegrityError?: boolean }) | undefined;
    try {
      assertAcceptedAioncoreReleaseTag(
        ACCEPTED_AIONCORE_TAG,
        () =>
          `1111111111111111111111111111111111111111\trefs/tags/${ACCEPTED_AIONCORE_TAG}\n` +
          `${ACCEPTED_AIONCORE_SOURCE_COMMIT}\trefs/tags/${ACCEPTED_AIONCORE_TAG}^{}\n`
      );
    } catch (error) {
      if (error instanceof Error) failure = error;
    }

    expect(failure).toMatchObject({ isAioncoreIntegrityError: true });
    expect(failure?.message).toMatch(/release tag identity verification failed/);
  });

  it('checks the annotated tag identity before downloading the accepted release', () => {
    const root = mkdtempSync(join(tmpdir(), 'aioncore-release-tag-identity-'));
    const previousSource = process.env.AIONUI_AIONCORE_SOURCE;
    delete process.env.AIONUI_AIONCORE_SOURCE;

    try {
      expect(() =>
        prepareAioncore({
          projectRoot: root,
          platform: 'darwin',
          arch: 'arm64',
          version: ACCEPTED_AIONCORE_TAG,
          releaseBundleContract: legacyFixtureContract(['darwin-arm64']),
          resolveAioncoreRefs: () =>
            `1111111111111111111111111111111111111111\trefs/tags/${ACCEPTED_AIONCORE_TAG}\n` +
            `${ACCEPTED_AIONCORE_SOURCE_COMMIT}\trefs/tags/${ACCEPTED_AIONCORE_TAG}^{}\n`,
        })
      ).toThrow(/release tag identity verification failed/);
    } finally {
      if (previousSource === undefined) delete process.env.AIONUI_AIONCORE_SOURCE;
      else process.env.AIONUI_AIONCORE_SOURCE = previousSource;
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Scope note (BUG-040): injected ref output verifies gate behavior without
  // claiming that a fixture proves real-world provenance. Production obtains
  // this independent input from git ls-remote on the publishing host.
  it('accepts a completed successful run whose head is the pinned source commit', () => {
    expect(
      assertAcceptedActionsRun(
        {
          conclusion: 'success',
          head_sha: ACCEPTED_AIONCORE_SOURCE_COMMIT,
          status: 'completed',
        },
        'unknown',
        resolvePublishedAioncoreRefs
      )
    ).toEqual({
      conclusion: 'success',
      headSha: ACCEPTED_AIONCORE_SOURCE_COMMIT,
      status: 'completed',
    });
  });

  it('admits an Actions run against the contract-provided source commit instead of the legacy singleton', () => {
    const expectedSourceCommit = '2222222222222222222222222222222222222222';
    const resolveContractRefs = () => `${expectedSourceCommit}\trefs/heads/release-contract\n`;

    expect(
      assertAcceptedActionsRun(
        {
          conclusion: 'success',
          head_sha: expectedSourceCommit,
          status: 'completed',
        },
        'strict-run',
        resolveContractRefs,
        expectedSourceCommit
      )
    ).toEqual({
      conclusion: 'success',
      headSha: expectedSourceCommit,
      status: 'completed',
    });
  });

  posixFakeToolchainIt(
    'passes the strict contract source commit through the Actions preparation path',
    () => {
      const tmp = mkdtempSync(join(tmpdir(), 'aionui-actions-contract-sha-'));
      const fakeBin = createFakeToolchain(tmp);
      const previousPath = process.env.PATH;
      process.env.PATH = `${fakeBin}${delimiter}${previousPath || ''}`;
      process.env.AIONUI_BACKEND_RUN_ID = '123';
      const restoreTmpdir = useIsolatedTmpdir(tmp);

      try {
        expect(() =>
          prepareAioncore({
            projectRoot: join(tmp, 'project'),
            platform: 'darwin',
            arch: 'arm64',
            version: '0.1.55',
            releaseBundleContract: {
              repository: 'khoapnt-vng/aioncore',
              exactVersion: '0.1.55',
              expectedSourceCommit: '2222222222222222222222222222222222222222',
              expectedLineage: acceptedMigrationLineage,
              allowedRuntimeKeys: ['darwin-arm64', 'win32-x64'],
              requireCompleteBundle: true,
            },
          })
        ).toThrow(/does not match accepted source commit 2222222222222222222222222222222222222222/);
      } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        restoreTmpdir();
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    FAKE_TOOLCHAIN_TIMEOUT_MS
  );

  it('rejects an echoed accepted commit when the publishing host does not advertise it', () => {
    const unrelatedPublishedRefs = '7061136ee8159d6e2768cabfa40b22d49351e74b\trefs/heads/main\n';

    expect(() =>
      assertAcceptedActionsRun(
        {
          conclusion: 'success',
          head_sha: ACCEPTED_AIONCORE_SOURCE_COMMIT,
          status: 'completed',
        },
        '27319522909',
        () => unrelatedPublishedRefs
      )
    ).toThrow(/does not resolve on publishing host/);
  });

  it.each([
    [
      'a different source commit',
      { conclusion: 'success', head_sha: '7061136ee8159d6e2768cabfa40b22d49351e74b', status: 'completed' },
      /does not match accepted source commit/,
    ],
    [
      'an unfinished run',
      { conclusion: null, head_sha: ACCEPTED_AIONCORE_SOURCE_COMMIT, status: 'in_progress' },
      /is not completed successfully/,
    ],
    [
      'a failed run',
      { conclusion: 'failure', head_sha: ACCEPTED_AIONCORE_SOURCE_COMMIT, status: 'completed' },
      /is not completed successfully/,
    ],
  ])('rejects %s', (_case, run, expectedMessage) => {
    expect(() => assertAcceptedActionsRun(run, 'unknown', resolvePublishedAioncoreRefs)).toThrow(expectedMessage);
  });

  it.each([
    ['win32', 'x64', 'aioncore-manual-windows-x64'],
    ['win32', 'arm64', 'aioncore-manual-windows-arm64'],
    ['darwin', 'x64', 'aioncore-manual-macos-x64'],
    ['darwin', 'arm64', 'aioncore-manual-macos-arm64'],
    ['linux', 'x64', 'aioncore-manual-linux-x64'],
    ['linux', 'arm64', 'aioncore-manual-linux-arm64'],
  ])('maps %s-%s to %s', (platform, arch, artifactName) => {
    expect(getActionsArtifactName(platform, arch)).toBe(artifactName);
  });

  it('explains which AionCore manual artifact is missing for the requested platform', () => {
    expect(
      getActionsArtifactMissingMessage({
        runId: '27319522909',
        platform: 'win32',
        arch: 'x64',
        expectedArtifactName: 'aioncore-manual-windows-x64',
        availableArtifactNames: ['aioncore-manual-macos-arm64', 'aioncore-manual-linux-x64'],
      })
    ).toBe(
      [
        'AionCore run 27319522909 does not contain artifact [ aioncore-manual-windows-x64 ] required for [ win32-x64 ].',
        'Available artifacts: aioncore-manual-macos-arm64, aioncore-manual-linux-x64.',
        'Re-run AionCore Manual Build with platform [ windows-x64 ] or all.',
      ].join(' ')
    );
  });

  // These cases execute a temporary POSIX shell-script aioncore binary. Windows
  // coverage for contract rejection lives in the verifier/local-bundle tests.
  posixFakeToolchainIt(
    'hard fails Actions artifact input when prepared managed resources lack contract',
    () => {
      const tmp = mkdtempSync(join(tmpdir(), 'aionui-actions-gate-'));
      const fakeBin = createFakeToolchain(tmp);
      const previousPath = process.env.PATH;
      process.env.PATH = `${fakeBin}${delimiter}${previousPath || ''}`;
      process.env.AIONUI_BACKEND_RUN_ID = '123';
      const restoreTmpdir = useIsolatedTmpdir(tmp);

      try {
        expect(() =>
          prepareAioncore({
            projectRoot: join(tmp, 'project'),
            platform: 'linux',
            arch: 'x64',
            version: 'v0.1.46',
            resolveAioncoreRefs: resolvePublishedAioncoreRefs,
            releaseBundleContract: legacyFixtureContract(),
          })
        ).toThrow(/managed-resources\/manifest\.json/);
      } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        restoreTmpdir();
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    FAKE_TOOLCHAIN_TIMEOUT_MS
  );

  posixFakeToolchainIt(
    'hard fails GitHub release download input when prepared managed resources lack contract',
    () => {
      const tmp = mkdtempSync(join(tmpdir(), 'aionui-download-gate-'));
      const fakeBin = createFakeToolchain(tmp);
      const previousPath = process.env.PATH;
      process.env.PATH = `${fakeBin}${delimiter}${previousPath || ''}`;
      // Bypass the pinned-digest gate (covered by verifyAioncoreArtifactDigest tests)
      // so this test reaches the managed-resources contract check it targets.
      const previousSkipVerify = process.env.AIONUI_SKIP_AIONCORE_VERIFY;
      process.env.AIONUI_SKIP_AIONCORE_VERIFY = '1';
      const restoreTmpdir = useIsolatedTmpdir(tmp);

      try {
        expect(() =>
          prepareAioncore({
            projectRoot: join(tmp, 'project'),
            platform: 'linux',
            arch: 'x64',
            version: 'v0.1.46',
            releaseBundleContract: legacyFixtureContract(),
          })
        ).toThrow(/managed-resources\/manifest\.json/);
      } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        if (previousSkipVerify === undefined) delete process.env.AIONUI_SKIP_AIONCORE_VERIFY;
        else process.env.AIONUI_SKIP_AIONCORE_VERIFY = previousSkipVerify;
        restoreTmpdir();
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    FAKE_TOOLCHAIN_TIMEOUT_MS
  );

  posixFakeToolchainIt(
    'hard fails local binary fallback when prepared managed resources lack contract',
    () => {
      const tmp = mkdtempSync(join(tmpdir(), 'aionui-local-binary-gate-'));
      const localBinary = join(tmp, 'aioncore');
      const localLineage = join(tmp, 'migration-lineage.json');
      writeExecutable(localBinary, '#!/usr/bin/env bash\nexit 0\n');
      writeFile(localLineage, `${JSON.stringify(acceptedMigrationLineage, null, 2)}\n`);
      const fakeBin = createFakeToolchain(tmp, { curlFails: true });
      const previousPath = process.env.PATH;
      process.env.PATH = `${fakeBin}${delimiter}${previousPath || ''}`;
      process.env.AIONUI_BACKEND_LOCAL_BINARY = localBinary;
      process.env.AIONUI_BACKEND_LOCAL_LINEAGE = localLineage;
      const restoreTmpdir = useIsolatedTmpdir(tmp);

      try {
        expect(() =>
          prepareAioncore({
            projectRoot: join(tmp, 'project'),
            platform: 'linux',
            arch: 'x64',
            version: 'v0.1.46',
            releaseBundleContract: legacyFixtureContract(),
          })
        ).toThrow(/managed-resources\/manifest\.json/);
      } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        restoreTmpdir();
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    FAKE_TOOLCHAIN_TIMEOUT_MS
  );

  posixFakeToolchainIt(
    'fails closed when local binary fallback has no lineage provenance',
    () => {
      const tmp = mkdtempSync(join(tmpdir(), 'aionui-local-binary-lineage-'));
      const localBinary = join(tmp, 'aioncore');
      writeExecutable(localBinary, '#!/usr/bin/env bash\nexit 0\n');
      const fakeBin = createFakeToolchain(tmp, { curlFails: true });
      const previousPath = process.env.PATH;
      process.env.PATH = `${fakeBin}${delimiter}${previousPath || ''}`;
      process.env.AIONUI_BACKEND_LOCAL_BINARY = localBinary;
      const restoreTmpdir = useIsolatedTmpdir(tmp);

      try {
        expect(() =>
          prepareAioncore({
            projectRoot: join(tmp, 'project'),
            platform: 'linux',
            arch: 'x64',
            version: 'v0.1.46',
            releaseBundleContract: legacyFixtureContract(),
          })
        ).toThrow(/AIONUI_BACKEND_LOCAL_LINEAGE/);
      } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        restoreTmpdir();
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    FAKE_TOOLCHAIN_TIMEOUT_MS
  );
});
