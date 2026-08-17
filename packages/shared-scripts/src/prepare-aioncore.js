/**
 * Prepare aioncore binary for packaging.
 *
 * Resolution order:
 *  1. GitHub Actions artifact download when AIONUI_BACKEND_RUN_ID is set
 *  2. GitHub release download (requires version or defaults to "latest")
 *  3. Complete local bundle from AIONUI_BACKEND_LOCAL_BUNDLE_DIR
 *  4. Local binary fallback from AIONUI_BACKEND_LOCAL_BINARY
 *
 * Output: {projectRoot}/resources/bundled-aioncore/{platform}-{arch}/
 *   - aioncore[.exe]
 *   - manifest.json
 *   - managed-resources/...
 *
 * @module prepare-aioncore
 */

const { execSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const {
  acceptedMigrationLineage,
  getAcceptedMigrationLineageManifest,
  verifyBundledAioncoreResources,
} = require('./verify-bundled-aioncore-resources');

const aioncoreChecksums = require('./aioncore-checksums');
const aioncoreTrust = require('./aioncore-trust');
const { assertGitShaResolvesOnRemote, listRemoteRefs } = require('./verify-git-source-commit');

// Security-patched fork (D-01 loopback token, MCP OAuth discovery/DCR fix).
// The upstream iOfficeAI/AionCore is unpatched; the desktop app ships the fork.
const GITHUB_OWNER = 'khoapnt-vng';
const GITHUB_REPO = 'aioncore';
const AIONCORE_PUBLISHING_REMOTE = 'https://github.com/khoapnt-vng/aioncore.git';

// Exact Sprint 3 internal-test bundle source. This commit is intentionally
// consumed from authenticated Actions artifacts rather than a public release.
const ACCEPTED_AIONCORE_SOURCE_COMMIT = '7f4a4b8975ca1df5252765befaf3443105633e2f';

// Default Forge mirror that publishes cosign-signed, self-built AionCore
// artifacts (see aioncore-trust.js). Overridable via env for other mirrors.
const FORGE_SOURCE_OWNER_REPO = 'minhtq1234/Forge-Aion';

/**
 * AionCore source selector.
 *  - 'upstream' (default): pinned-SHA-256 verification of the iOfficeAI release
 *    (unchanged behavior — nothing changes unless the operator opts in).
 *  - 'forge': download a cosign-signed artifact from the Forge mirror and verify
 *    the signature against the pinned Forge CI identity + issuer before extract.
 */
const SOURCE_ENV = 'AIONUI_AIONCORE_SOURCE';
const FORGE_SOURCE_REPO_ENV = 'AIONUI_FORGE_SOURCE_REPO';
const FORGE_SOURCE_TAG_ENV = 'AIONUI_FORGE_SOURCE_TAG';

/**
 * Break-glass env override for LOCAL DEVELOPMENT ONLY.
 *
 * When set to '1', the pinned-digest integrity check is skipped and a LOUD
 * warning is printed. This exists so a developer can test against a locally
 * built / unreleased AionCore archive that has no committed digest. It must
 * NEVER be set in CI or production — doing so re-opens the remote-code-execution
 * path this verification closes (Forge finding #1).
 */
const SKIP_VERIFY_ENV = 'AIONUI_SKIP_AIONCORE_VERIFY';

const ACTIONS_ARTIFACT_TARGETS = {
  'darwin-arm64': {
    artifactName: 'aioncore-manual-macos-arm64',
    manualPlatform: 'macos-arm64',
  },
  'darwin-x64': {
    artifactName: 'aioncore-manual-macos-x64',
    manualPlatform: 'macos-x64',
  },
  'linux-arm64': {
    artifactName: 'aioncore-manual-linux-arm64',
    manualPlatform: 'linux-arm64',
  },
  'linux-x64': {
    artifactName: 'aioncore-manual-linux-x64',
    manualPlatform: 'linux-x64',
  },
  'win32-arm64': {
    artifactName: 'aioncore-manual-windows-arm64',
    manualPlatform: 'windows-arm64',
  },
  'win32-x64': {
    artifactName: 'aioncore-manual-windows-x64',
    manualPlatform: 'windows-x64',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function removeDirectorySafe(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function copyFileSafe(sourcePath, targetPath) {
  ensureDirectory(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function copyDirectorySafe(sourcePath, targetPath) {
  ensureDirectory(path.dirname(targetPath));
  fs.cpSync(sourcePath, targetPath, { recursive: true, force: true, verbatimSymlinks: true });
}

function ensureExecutableMode(filePath) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {}
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
}

/**
 * Reject any download URL that is not https before it is handed to a downloader.
 * Defense-in-depth alongside the client-side https-only redirect flags.
 * @param {string} url
 * @throws {Error} when the URL is not https.
 */
function assertHttpsUrl(url) {
  if (!/^https:\/\//i.test(String(url))) {
    throw new Error(`Refusing to download AionCore over a non-HTTPS URL: ${url}`);
  }
}

function getBinaryName(platform) {
  return platform === 'win32' ? 'aioncore.exe' : 'aioncore';
}

function assertAcceptedMigrationLineageFile(lineagePath, sourceLabel) {
  let document;
  try {
    document = JSON.parse(fs.readFileSync(lineagePath, 'utf8'));
  } catch {
    throw makeIntegrityError(`AionCore ${sourceLabel} is missing a valid migration-lineage.json document.`);
  }
  if (!isDeepStrictEqual(document, acceptedMigrationLineage)) {
    throw makeIntegrityError(
      `AionCore ${sourceLabel} migration lineage does not match the accepted WePrompt lineage ` +
        `${acceptedMigrationLineage.fingerprint}. Refusing to package an incompatible runtime.`
    );
  }
  return lineagePath;
}

function buildBundleManifest({ platform, arch, version, sourceType, source, generatedAt = new Date().toISOString() }) {
  return {
    platform,
    arch,
    version,
    generatedAt,
    sourceType,
    source,
    migrationLineage: getAcceptedMigrationLineageManifest(),
    files: [getBinaryName(platform), 'migration-lineage.json', 'managed-resources/'],
  };
}

// ---------------------------------------------------------------------------
// Integrity verification (Forge finding #1)
// ---------------------------------------------------------------------------

/**
 * Whether the pinned-digest verification is skipped via the break-glass env.
 * @returns {boolean}
 */
function isVerificationSkipped() {
  return (process.env[SKIP_VERIFY_ENV] || '').trim() === '1';
}

/**
 * Compute the SHA-256 digest of a file as lowercase hex.
 * @param {string} filePath
 * @returns {string}
 */
function computeSha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

/**
 * Build an Error tagged as an integrity failure. Callers use isIntegrityError()
 * to distinguish it from a recoverable download failure (a network glitch may
 * fall back to another source; a failed integrity check must NEVER fall back).
 * @param {string} message
 * @returns {Error}
 */
function makeIntegrityError(message) {
  const error = new Error(message);
  error.isAioncoreIntegrityError = true;
  return error;
}

/**
 * @param {unknown} error
 * @returns {boolean} true when the error is a tagged integrity failure.
 */
function isIntegrityError(error) {
  return Boolean(error && error.isAioncoreIntegrityError === true);
}

/**
 * Verify a downloaded release archive against the digest pinned in our repo,
 * BEFORE it is extracted or executed.
 *
 * Trust model: the pin committed in `aioncore-checksums.js` is the trust anchor.
 * We do NOT trust the release-served checksums file (it is unsigned). Fail-closed:
 * a mismatch OR a missing pin throws, so the archive is never extracted/executed.
 *
 * @param {object} params
 * @param {string} params.archivePath - Path to the downloaded archive on disk.
 * @param {string} params.assetName - Release asset file name (pin lookup key).
 * @param {string} params.version - AionCore release tag (pin lookup key).
 * @throws {Error} on missing pin or digest mismatch.
 */
function verifyArchiveDigest({ archivePath, assetName, version }) {
  if (isVerificationSkipped()) {
    console.warn(
      `  ⚠️  ${SKIP_VERIFY_ENV}=1 — SKIPPING AionCore integrity verification for ${assetName}. ` +
        `This is for LOCAL DEVELOPMENT ONLY and must NEVER be used in CI or production.`
    );
    return;
  }

  // Resolve the pin through the module object (not a captured reference) so the
  // lookup is easy to stub in unit tests and always reflects the committed map.
  const expected = aioncoreChecksums.getPinnedDigest(version, assetName);
  if (!expected) {
    throw makeIntegrityError(
      `No pinned SHA-256 digest for AionCore asset "${assetName}" at version "${version}". ` +
        `Refusing to extract or execute an unverified artifact (fail-closed). ` +
        `Add the digest to packages/shared-scripts/src/aioncore-checksums.js ` +
        `(see the regeneration instructions in that file), or set ${SKIP_VERIFY_ENV}=1 for local dev only.`
    );
  }

  const actual = computeSha256(archivePath);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw makeIntegrityError(
      `AionCore artifact integrity check FAILED for "${assetName}" (version "${version}").\n` +
        `  expected SHA-256: ${expected}\n` +
        `  actual   SHA-256: ${actual}\n` +
        `The downloaded archive does not match the pinned digest. It will NOT be extracted or executed. ` +
        `This may indicate a corrupted download, a tampered release, or a man-in-the-middle attack.`
    );
  }

  console.log(`  Verified AionCore artifact SHA-256 against pinned digest: ${assetName}`);
}

/**
 * Resolve the configured AionCore source.
 * @returns {'upstream' | 'forge'}
 */
function getAioncoreSource() {
  const raw = (process.env[SOURCE_ENV] || '').trim().toLowerCase();
  return raw === 'forge' ? 'forge' : 'upstream';
}

/**
 * Low-level cosign invocation, isolated so tests can inject a fake runner
 * (the real one shells out to the `cosign` binary; we never hit the network in
 * unit tests). Returns nothing on success; throws on non-zero exit or a missing
 * `cosign` binary. Errors are surfaced to verifyCosignSignature which converts
 * them into a tagged, fail-closed integrity error.
 *
 * @param {string[]} args - cosign CLI arguments.
 */
function runCosignVerify(args) {
  execFileSync('cosign', args, { stdio: 'pipe', timeout: 120000 });
}

// Indirection object so verifyCosignSignature calls cosign through a property
// that unit tests can override, mirroring how verifyArchiveDigest resolves its
// pin through the aioncoreChecksums module object.
const cosign = { run: runCosignVerify };

/**
 * Verify a downloaded archive's cosign keyless signature against the pinned
 * Forge CI signer identity + OIDC issuer, BEFORE the archive is extracted or
 * executed.
 *
 * Trust model (Forge path): the trust anchor is the SIGNATURE — not a pinned
 * SHA-256 — because a self-built binary's digest changes on every build. cosign
 * returns 0 only when the signature bundle was produced by exactly the pinned
 * workflow identity issued by exactly the pinned OIDC issuer. Fail-closed: a
 * non-zero cosign exit OR a missing `cosign` binary throws a tagged integrity
 * error, so the archive is never extracted/executed.
 *
 * @param {object} params
 * @param {string} params.archivePath - Path to the downloaded archive on disk.
 * @param {string} params.bundlePath - Path to the `.cosign.bundle` on disk.
 * @param {string} params.identity - Pinned certificate identity (workflow ref).
 * @param {string} params.issuer - Pinned certificate OIDC issuer.
 * @throws {Error} tagged integrity error on failure or missing cosign.
 */
function verifyCosignSignature({ archivePath, bundlePath, identity, issuer }) {
  if (!identity || !issuer) {
    throw makeIntegrityError(
      `No pinned Forge signer identity/issuer for this AionCore version. ` +
        `Refusing to extract or execute an unverified artifact (fail-closed). ` +
        `Add the trust anchor to packages/shared-scripts/src/aioncore-trust.js ` +
        `(see the regeneration instructions in that file).`
    );
  }

  const args = [
    'verify-blob',
    '--bundle',
    bundlePath,
    '--certificate-identity',
    identity,
    '--certificate-oidc-issuer',
    issuer,
    archivePath,
  ];

  try {
    cosign.run(args);
  } catch (error) {
    // ENOENT → `cosign` binary is not installed. Any other error → non-zero exit
    // (verification failed: wrong identity/issuer, tampered artifact/bundle, etc).
    const missingBinary = error && (error.code === 'ENOENT' || /ENOENT/.test(String(error.message || '')));
    if (missingBinary) {
      throw makeIntegrityError(
        `AionCore Forge-signed source requires the "cosign" binary, which was not found on PATH. ` +
          `Refusing to extract or execute an unverified artifact (fail-closed). ` +
          `Install Sigstore cosign (https://docs.sigstore.dev/cosign/installation) or use the ` +
          `default upstream source (${SOURCE_ENV}=upstream).`
      );
    }
    const detail = String((error && (error.stderr || error.message)) || error).trim();
    throw makeIntegrityError(
      `AionCore cosign signature verification FAILED.\n` +
        `  identity: ${identity}\n` +
        `  issuer:   ${issuer}\n` +
        `  cosign:   ${detail}\n` +
        `The signature does not match the pinned Forge CI identity/issuer. The archive will NOT be ` +
        `extracted or executed. This may indicate a tampered artifact, a wrong signer, or a spoofed mirror.`
    );
  }

  console.log(`  Verified AionCore cosign signature against pinned Forge identity: ${identity}`);
}

function getActionsTarget(platform, arch) {
  return ACTIONS_ARTIFACT_TARGETS[`${platform}-${arch}`] || null;
}

function getActionsArtifactName(platform, arch) {
  return getActionsTarget(platform, arch)?.artifactName || null;
}

function getActionsManualPlatform(platform, arch) {
  return getActionsTarget(platform, arch)?.manualPlatform || `${platform}-${arch}`;
}

function getActionsArtifactMissingMessage({ runId, platform, arch, expectedArtifactName, availableArtifactNames }) {
  const available =
    Array.isArray(availableArtifactNames) && availableArtifactNames.length > 0
      ? availableArtifactNames.join(', ')
      : '(none)';
  return [
    `AionCore run ${runId} does not contain artifact [ ${expectedArtifactName} ] required for [ ${platform}-${arch} ].`,
    `Available artifacts: ${available}.`,
    `Re-run AionCore Manual Build with platform [ ${getActionsManualPlatform(platform, arch)} ] or all.`,
  ].join(' ');
}

function findCompleteActionsBundleRoot(binaryPath) {
  const root = path.dirname(binaryPath);
  const lineagePath = path.join(root, 'migration-lineage.json');
  const managedResourcesPath = path.join(root, 'managed-resources');
  if (!fs.existsSync(lineagePath) || !fs.existsSync(managedResourcesPath)) return null;
  if (!fs.statSync(lineagePath).isFile() || !fs.statSync(managedResourcesPath).isDirectory()) return null;
  return root;
}

function prepareManagedResources(binaryPath, targetDir) {
  const bundleOut = path.join(targetDir, 'managed-resources');
  const dataDir = path.join(targetDir, '.prepare-data');

  removeDirectorySafe(bundleOut);
  removeDirectorySafe(dataDir);
  ensureDirectory(bundleOut);
  ensureDirectory(dataDir);

  console.log(`  Preparing managed resources under ${path.relative(process.cwd(), bundleOut)}`);
  execFileSync(binaryPath, ['--data-dir', dataDir, 'prepare-managed-resources', '--bundle-out', bundleOut], {
    stdio: 'inherit',
    env: {
      ...process.env,
      AIONUI_BUNDLED_MANAGED_RESOURCES: '',
    },
  });

  removeDirectorySafe(dataDir);
  return bundleOut;
}

function verifyPreparedAioncoreBundle(projectRoot, platform, arch) {
  const result = verifyBundledAioncoreResources({
    resourcesDir: path.join(projectRoot, 'resources'),
    electronPlatformName: platform,
    targetArch: arch,
  });
  if (result.missing.length > 0 || result.failures.length > 0) {
    const summary = result.missing.length > 0 ? result.missing.join(', ') : JSON.stringify(result.failures);
    throw new Error(`Prepared aioncore bundle is missing required bundled resource(s): ${summary}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Source resolvers
// ---------------------------------------------------------------------------

/**
 * Resolve the actual version tag when "latest" is requested.
 * Uses GitHub API via `gh` CLI (needs GH_TOKEN in CI) or falls back to
 * `curl` with an optional Authorization header (GITHUB_TOKEN / GH_TOKEN).
 */
function resolveLatestTag() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

  // 1. Try gh CLI (honours GH_TOKEN automatically)
  try {
    const out = execSync(`gh api repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest --jq .tag_name`, {
      encoding: 'utf-8',
      timeout: 15000,
    }).trim();
    if (out) return out;
  } catch {
    // gh CLI not available or no token — fall back to curl
  }

  // 2. Curl with optional token to avoid rate-limit 403
  try {
    const authArgs = token ? ['-H', `Authorization: token ${token}`] : [];
    const args = ['-fsSL', ...authArgs, `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`];
    const out = execFileSync('curl', args, { encoding: 'utf-8', timeout: 15000 });
    const tag = JSON.parse(out).tag_name;
    if (tag) return tag;
  } catch {
    // network issue or rate-limited
  }

  return null;
}

/**
 * Build the release asset filename for the given platform/arch/tag.
 *
 * Expected asset naming convention:
 *   aioncore-v0.1.0-aarch64-apple-darwin.tar.gz
 */
function getAssetName(platform, arch, tag) {
  const archMap = { x64: 'x86_64', arm64: 'aarch64' };
  const platformMap = {
    darwin: 'apple-darwin',
    linux: 'unknown-linux-gnu',
    win32: 'pc-windows-msvc',
  };
  const normalizedArch = archMap[arch];
  const normalizedPlatform = platformMap[platform];
  if (!normalizedArch || !normalizedPlatform) return null;
  const ext = platform === 'win32' ? '.zip' : '.tar.gz';
  return `aioncore-${tag}-${normalizedArch}-${normalizedPlatform}${ext}`;
}

function getDownloadUrl(assetName, tag) {
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${tag}/${assetName}`;
}

function downloadFile(url, outputPath) {
  console.log(`  Downloading aioncore from ${url}`);
  // SECURITY (Forge #1): enforce HTTPS on the initial request AND across any
  // redirect. A downgrade to http on a redirect would expose the download to
  // MITM tampering before the digest check runs.
  assertHttpsUrl(url);
  if (process.platform === 'win32') {
    // Invoke-WebRequest follows redirects; the scheme is validated up front and
    // curl/wget below (used on non-Windows) refuse http redirects at the client.
    const ps = `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${url}' -OutFile '${outputPath.replace(/'/g, "''")}'`;
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      timeout: 120000,
    });
    return;
  }
  try {
    // --proto '=https' / --proto-redir '=https' → curl aborts if the URL or any
    // redirect target is not https.
    execFileSync(
      'curl',
      [
        '--proto',
        '=https',
        '--proto-redir',
        '=https',
        '-L',
        '--fail',
        '--silent',
        '--show-error',
        '-o',
        outputPath,
        url,
      ],
      { timeout: 120000 }
    );
  } catch {
    // --https-only → wget refuses to follow a redirect to a non-https URL.
    execFileSync('wget', ['--https-only', '-q', '-O', outputPath, url], { timeout: 120000 });
  }
}

function extractArchive(archivePath, outputDir, platform) {
  ensureDirectory(outputDir);
  if (platform === 'win32' || archivePath.endsWith('.zip')) {
    if (platform === 'win32') {
      const ps = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${outputDir.replace(/'/g, "''")}' -Force`;
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    } else {
      execFileSync('unzip', ['-o', archivePath, '-d', outputDir]);
    }
  } else {
    execFileSync('tar', ['-xzf', archivePath, '-C', outputDir]);
  }
}

function findBinaryInDir(dir, binaryName) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === binaryName) return fullPath;
    if (entry.isDirectory()) {
      const found = findBinaryInDir(fullPath, binaryName);
      if (found) return found;
    }
  }
  return null;
}

function findFileInDir(dir, fileName) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === fileName) return fullPath;
    if (entry.isDirectory()) {
      const found = findFileInDir(fullPath, fileName);
      if (found) return found;
    }
  }
  return null;
}

function findAioncoreArchiveInDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (
      entry.isFile() &&
      entry.name.startsWith('aioncore-') &&
      (entry.name.endsWith('.zip') || entry.name.endsWith('.tar.gz'))
    ) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const found = findAioncoreArchiveInDir(fullPath);
      if (found) return found;
    }
  }
  return null;
}

function getGitHubToken() {
  return process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
}

function githubApiGetJson(apiPath) {
  const token = getGitHubToken();

  try {
    return JSON.parse(
      execFileSync('gh', ['api', apiPath], {
        encoding: 'utf-8',
        timeout: 15000,
        env: {
          ...process.env,
          GH_TOKEN: token || process.env.GH_TOKEN,
        },
      })
    );
  } catch {
    // gh CLI not available or failed — fall back to curl.
  }

  const headers = ['-H', 'Accept: application/vnd.github+json'];
  if (token) {
    headers.push('-H', `Authorization: Bearer ${token}`);
  }

  const url = `https://api.github.com/${apiPath}`;
  const out = execFileSync('curl', ['-fsSL', ...headers, url], {
    encoding: 'utf-8',
    timeout: 15000,
  });
  return JSON.parse(out);
}

function downloadFileWithAuth(url, outputPath) {
  const token = getGitHubToken();
  const headers = ['-H', 'Accept: application/vnd.github+json'];
  if (token) {
    headers.push('-H', `Authorization: Bearer ${token}`);
  }

  // SECURITY (Forge #1): enforce HTTPS on the request and every redirect so an
  // authenticated download cannot be downgraded to plaintext http.
  assertHttpsUrl(url);

  try {
    execFileSync(
      'curl',
      [
        '--proto',
        '=https',
        '--proto-redir',
        '=https',
        '-L',
        '--fail',
        '--silent',
        '--show-error',
        ...headers,
        '-o',
        outputPath,
        url,
      ],
      {
        timeout: 120000,
      }
    );
    return;
  } catch {
    // curl may be unavailable in some local environments; try gh before failing.
  }

  // `gh api` only ever talks to the GitHub API over https; the URL is validated
  // above for defense-in-depth.
  execFileSync('gh', ['api', url, '--output', outputPath], {
    timeout: 120000,
    env: {
      ...process.env,
      GH_TOKEN: token || process.env.GH_TOKEN,
    },
  });
}

function listActionsArtifacts(runId) {
  const response = githubApiGetJson(
    `repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}/artifacts?per_page=100`
  );
  return Array.isArray(response?.artifacts) ? response.artifacts : [];
}

function assertAcceptedActionsRun(run, runId = 'unknown', resolveRefs = listRemoteRefs) {
  const status = typeof run?.status === 'string' ? run.status : 'unknown';
  const conclusion = typeof run?.conclusion === 'string' ? run.conclusion : 'unknown';
  const headSha = typeof run?.head_sha === 'string' ? run.head_sha : 'unknown';

  if (status !== 'completed' || conclusion !== 'success') {
    throw makeIntegrityError(
      `AionCore run ${runId} is not completed successfully (status=${status}, conclusion=${conclusion}).`
    );
  }
  if (headSha !== ACCEPTED_AIONCORE_SOURCE_COMMIT) {
    throw makeIntegrityError(
      `AionCore run ${runId} head ${headSha} does not match accepted source commit ` +
        `${ACCEPTED_AIONCORE_SOURCE_COMMIT}.`
    );
  }
  assertGitShaResolvesOnRemote({
    sha: headSha,
    remoteUrl: AIONCORE_PUBLISHING_REMOTE,
    resolveRefs,
  });

  return { conclusion, headSha, status };
}

function getAcceptedActionsRun(runId, resolveRefs) {
  const run = githubApiGetJson(`repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${runId}`);
  return assertAcceptedActionsRun(run, runId, resolveRefs);
}

function downloadAndExtractActionsArtifact(platform, arch, runId, resolveRefs) {
  const expectedArtifactName = getActionsArtifactName(platform, arch);
  if (!expectedArtifactName) {
    throw new Error(`Unsupported AionCore Actions artifact target: ${platform}-${arch}`);
  }

  const acceptedRun = getAcceptedActionsRun(runId, resolveRefs);
  const artifacts = listActionsArtifacts(runId);
  const availableArtifactNames = artifacts
    .map((artifact) => artifact.name)
    .filter(Boolean)
    .toSorted();
  const artifact = artifacts.find((candidate) => candidate.name === expectedArtifactName);
  if (!artifact) {
    throw new Error(
      getActionsArtifactMissingMessage({
        runId,
        platform,
        arch,
        expectedArtifactName,
        availableArtifactNames,
      })
    );
  }

  const tempDir = path.join(os.tmpdir(), 'aioncore-prepare-actions', runId, `${platform}-${arch}`);
  const artifactZipPath = path.join(tempDir, `${expectedArtifactName}.zip`);
  const artifactExtractDir = path.join(tempDir, 'artifact');
  const binaryExtractDir = path.join(tempDir, 'binary');

  removeDirectorySafe(tempDir);
  ensureDirectory(tempDir);

  const downloadUrl =
    artifact.archive_download_url ||
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/artifacts/${artifact.id}/zip`;
  console.log(`  Downloading aioncore from AionCore run ${runId} artifact ${expectedArtifactName}`);
  downloadFileWithAuth(downloadUrl, artifactZipPath);
  extractArchive(artifactZipPath, artifactExtractDir, platform);

  const archivePath = findAioncoreArchiveInDir(artifactExtractDir);
  if (!archivePath) {
    throw new Error(`AionCore artifact ${expectedArtifactName} from run ${runId} does not contain an aioncore archive`);
  }

  extractArchive(archivePath, binaryExtractDir, platform);

  const binaryName = getBinaryName(platform);
  const binaryPath = findBinaryInDir(binaryExtractDir, binaryName);
  if (!binaryPath) {
    throw new Error(`Binary ${binaryName} not found in AionCore artifact ${expectedArtifactName} from run ${runId}`);
  }
  const lineagePath = findFileInDir(binaryExtractDir, 'migration-lineage.json');
  assertAcceptedMigrationLineageFile(lineagePath, `Actions artifact ${expectedArtifactName}`);

  return {
    binaryPath,
    lineagePath,
    bundleDir: findCompleteActionsBundleRoot(binaryPath),
    tempDir,
    artifactName: expectedArtifactName,
    archivePath,
    headSha: acceptedRun.headSha,
    url: downloadUrl,
  };
}

function downloadAndExtract(platform, arch, tag) {
  const assetName = getAssetName(platform, arch, tag);
  if (!assetName) {
    throw new Error(`Unsupported aioncore target: ${platform}-${arch}`);
  }

  const url = getDownloadUrl(assetName, tag);
  const tempDir = path.join(os.tmpdir(), 'aioncore-prepare', tag, `${platform}-${arch}`);
  const archivePath = path.join(tempDir, assetName);
  const extractDir = path.join(tempDir, 'extracted');

  removeDirectorySafe(tempDir);
  ensureDirectory(tempDir);

  downloadFile(url, archivePath);
  // SECURITY (Forge #1): verify the archive against the digest pinned in our
  // repo BEFORE extracting or executing anything. Fail-closed on mismatch or
  // missing pin — this is the RCE mitigation for the release-download path.
  verifyArchiveDigest({ archivePath, assetName, version: tag });
  extractArchive(archivePath, extractDir, platform);

  const binaryName = getBinaryName(platform);
  const binaryPath = findBinaryInDir(extractDir, binaryName);
  if (!binaryPath) {
    throw new Error(`Binary ${binaryName} not found in downloaded archive`);
  }
  const lineagePath = findFileInDir(extractDir, 'migration-lineage.json');
  assertAcceptedMigrationLineageFile(lineagePath, `release asset ${assetName}`);

  return { binaryPath, lineagePath, tempDir, url };
}

// ---------------------------------------------------------------------------
// Forge-signed source resolver (AIONUI_AIONCORE_SOURCE=forge)
// ---------------------------------------------------------------------------

/**
 * Resolve the Forge mirror owner/repo and release tag for a version.
 * Defaults to the Forge PoC mirror; both are overridable by env.
 *
 * @param {string} tag - Upstream AionCore release tag (e.g. 'v0.1.43').
 * @returns {{ ownerRepo: string; forgeTag: string }}
 */
function resolveForgeSource(tag) {
  const ownerRepo = (process.env[FORGE_SOURCE_REPO_ENV] || '').trim() || FORGE_SOURCE_OWNER_REPO;
  const forgeTag = (process.env[FORGE_SOURCE_TAG_ENV] || '').trim() || `${tag}-forge-poc`;
  return { ownerRepo, forgeTag };
}

function getForgeDownloadUrl(ownerRepo, forgeTag, fileName) {
  return `https://github.com/${ownerRepo}/releases/download/${forgeTag}/${fileName}`;
}

/**
 * Download the Forge-mirror archive AND its cosign bundle, verify the cosign
 * signature against the pinned Forge identity/issuer, then extract. The archive
 * is NEVER extracted until the signature verifies (fail-closed).
 *
 * Note: no pinned-SHA-256 check on this path — the trust anchor is the signature
 * (a self-built binary's digest changes per build).
 *
 * @param {string} platform
 * @param {string} arch
 * @param {string} tag - Upstream AionCore release tag (drives asset naming + pin).
 * @returns {{ binaryPath: string; tempDir: string; url: string; forgeTag: string; ownerRepo: string }}
 */
function downloadAndExtractForge(platform, arch, tag) {
  const assetName = getAssetName(platform, arch, tag);
  if (!assetName) {
    throw new Error(`Unsupported aioncore target: ${platform}-${arch}`);
  }

  const { ownerRepo, forgeTag } = resolveForgeSource(tag);
  const bundleName = `${assetName}.cosign.bundle`;
  const url = getForgeDownloadUrl(ownerRepo, forgeTag, assetName);
  const bundleUrl = getForgeDownloadUrl(ownerRepo, forgeTag, bundleName);

  const tempDir = path.join(os.tmpdir(), 'aioncore-prepare-forge', forgeTag, `${platform}-${arch}`);
  const archivePath = path.join(tempDir, assetName);
  const bundlePath = path.join(tempDir, bundleName);
  const extractDir = path.join(tempDir, 'extracted');

  removeDirectorySafe(tempDir);
  ensureDirectory(tempDir);

  console.log(`  Downloading Forge-signed aioncore from ${ownerRepo} @ ${forgeTag}`);
  // Reuse the HTTPS-enforced downloader for both the archive and its bundle.
  downloadFile(url, archivePath);
  downloadFile(bundleUrl, bundlePath);

  // SECURITY (Forge #1): verify the cosign signature against the pinned Forge CI
  // identity/issuer BEFORE extracting or executing anything. Fail-closed.
  const trust = aioncoreTrust.getForgeTrustAnchor(tag);
  verifyCosignSignature({
    archivePath,
    bundlePath,
    identity: trust?.identity,
    issuer: trust?.issuer,
  });

  extractArchive(archivePath, extractDir, platform);

  const binaryName = getBinaryName(platform);
  const binaryPath = findBinaryInDir(extractDir, binaryName);
  if (!binaryPath) {
    throw new Error(`Binary ${binaryName} not found in downloaded Forge archive`);
  }
  const lineagePath = findFileInDir(extractDir, 'migration-lineage.json');
  assertAcceptedMigrationLineageFile(lineagePath, `Forge asset ${assetName}`);

  return { binaryPath, lineagePath, tempDir, url, forgeTag, ownerRepo };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Prepare aioncore binary for packaging.
 *
 * @param {object} options - Configuration options
 * @param {string} options.projectRoot - Project root directory
 * @param {string} options.platform - Target platform (process.platform)
 * @param {string} options.arch - Target architecture (process.arch)
 * @param {string} options.version - Backend version (default: 'latest')
 * @param {(remoteUrl: string) => string} [options.resolveAioncoreRefs] - Git ref resolver
 * @returns {{ prepared: true; dir: string; sourceType: string }}
 */
function prepareAioncore(options) {
  const { projectRoot, platform, arch, version = 'latest', resolveAioncoreRefs = listRemoteRefs } = options;
  const runtimeKey = `${platform}-${arch}`;
  const actionsRunId = (process.env.AIONUI_BACKEND_RUN_ID || '').trim();

  let tag = null;
  if (!actionsRunId) {
    // Resolve the actual version tag — release asset filenames include the tag.
    if (version === 'latest') {
      const resolved = resolveLatestTag();
      if (!resolved) {
        throw new Error('Failed to resolve latest aioncore release tag from GitHub API');
      }
      tag = resolved;
      console.log(`Resolved aioncore "latest" → ${tag}`);
    } else {
      tag = version.startsWith('v') ? version : `v${version}`;
    }
  }

  const targetDir = path.join(projectRoot, 'resources', 'bundled-aioncore', runtimeKey);
  const binaryName = getBinaryName(platform);
  const targetBinaryPath = path.join(targetDir, binaryName);

  console.log(
    `Preparing aioncore for ${runtimeKey} (${actionsRunId ? `actions run: ${actionsRunId}` : `version: ${tag}`})`
  );

  removeDirectorySafe(targetDir);
  ensureDirectory(targetDir);

  const localBundleDir = (process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR || '').trim();
  if (localBundleDir) {
    const resolvedLocalBundleDir = path.resolve(localBundleDir);
    const localBinaryPath = path.join(resolvedLocalBundleDir, binaryName);
    const localLineagePath = path.join(resolvedLocalBundleDir, 'migration-lineage.json');
    const localManagedResourcesDir = path.join(resolvedLocalBundleDir, 'managed-resources');
    if (
      fs.existsSync(resolvedLocalBundleDir) &&
      fs.statSync(resolvedLocalBundleDir).isDirectory() &&
      fs.existsSync(localBinaryPath) &&
      fs.existsSync(localManagedResourcesDir)
    ) {
      assertAcceptedMigrationLineageFile(localLineagePath, `local bundle ${resolvedLocalBundleDir}`);
      copyDirectorySafe(resolvedLocalBundleDir, targetDir);
      ensureExecutableMode(targetBinaryPath);
      const manifest = buildBundleManifest({
        platform,
        arch,
        version: tag || (actionsRunId ? `actions-run-${actionsRunId}` : 'local-bundle'),
        sourceType: 'local-bundle',
        source: { path: resolvedLocalBundleDir },
      });
      writeJson(path.join(targetDir, 'manifest.json'), manifest);
      verifyPreparedAioncoreBundle(projectRoot, platform, arch);
      console.log(`  Using local aioncore bundle: ${resolvedLocalBundleDir}`);
      return { prepared: true, dir: targetDir, sourceType: 'local-bundle' };
    }
    console.warn(`  Local aioncore bundle is incomplete or missing: ${resolvedLocalBundleDir}`);
  }

  let sourcePath = null;
  let sourceLineagePath = null;
  let sourceBundleDir = null;
  let sourceType = 'none';
  let sourceDetail = {};
  let tempDir = null;

  // 1. Download from GitHub Actions artifacts when manual build run id is provided.
  if (actionsRunId) {
    const result = downloadAndExtractActionsArtifact(platform, arch, actionsRunId, resolveAioncoreRefs);
    sourcePath = result.binaryPath;
    sourceLineagePath = result.lineagePath;
    sourceBundleDir = result.bundleDir;
    tempDir = result.tempDir;
    sourceType = 'actions-artifact';
    sourceDetail = {
      runId: actionsRunId,
      artifactName: result.artifactName,
      headSha: result.headSha,
      url: result.url,
    };
    console.log(`  Downloaded from GitHub Actions artifact`);
  }

  // 2. Download from GitHub releases (upstream pinned-digest OR Forge-signed).
  const aioncoreSource = getAioncoreSource();
  if (!sourcePath && tag) {
    try {
      if (aioncoreSource === 'forge') {
        const result = downloadAndExtractForge(platform, arch, tag);
        sourcePath = result.binaryPath;
        sourceLineagePath = result.lineagePath;
        tempDir = result.tempDir;
        sourceType = 'forge-signed';
        sourceDetail = { url: result.url, ownerRepo: result.ownerRepo, forgeTag: result.forgeTag };
        console.log(`  Downloaded and cosign-verified from Forge mirror`);
      } else {
        const result = downloadAndExtract(platform, arch, tag);
        sourcePath = result.binaryPath;
        sourceLineagePath = result.lineagePath;
        tempDir = result.tempDir;
        sourceType = 'download';
        sourceDetail = { url: result.url };
        console.log(`  Downloaded from GitHub releases`);
      }
    } catch (error) {
      // SECURITY (Forge #1): a failed integrity check must be fatal — never fall
      // back to another source (which could serve the very artifact we rejected).
      // Only genuine download/network failures are recoverable here.
      if (isIntegrityError(error)) {
        throw error;
      }
      console.warn(`  Download failed: ${error?.message ?? error}`);
    }
  }

  // 3. Use an explicitly supplied local cache when network download is unavailable.
  if (!sourcePath) {
    const localBinary = (process.env.AIONUI_BACKEND_LOCAL_BINARY || '').trim();
    if (localBinary) {
      const resolvedLocalBinary = path.resolve(localBinary);
      if (fs.existsSync(resolvedLocalBinary) && fs.statSync(resolvedLocalBinary).isFile()) {
        const localLineage = (process.env.AIONUI_BACKEND_LOCAL_LINEAGE || '').trim();
        if (!localLineage) {
          throw makeIntegrityError(
            'AIONUI_BACKEND_LOCAL_BINARY requires AIONUI_BACKEND_LOCAL_LINEAGE pointing to its migration-lineage.json.'
          );
        }
        const resolvedLocalLineage = path.resolve(localLineage);
        sourceLineagePath = assertAcceptedMigrationLineageFile(
          resolvedLocalLineage,
          `local binary ${resolvedLocalBinary}`
        );
        sourcePath = resolvedLocalBinary;
        sourceType = 'local-binary';
        sourceDetail = { path: resolvedLocalBinary, migrationLineagePath: resolvedLocalLineage };
        console.log(`  Using local aioncore binary: ${resolvedLocalBinary}`);
      } else {
        console.warn(`  Local aioncore binary not found: ${resolvedLocalBinary}`);
      }
    }
  }

  // Write result
  if (sourcePath) {
    if (!sourceLineagePath) {
      throw makeIntegrityError(`AionCore source ${sourceType} did not provide migration-lineage.json.`);
    }
    if (sourceBundleDir) {
      copyDirectorySafe(sourceBundleDir, targetDir);
    } else {
      copyFileSafe(sourcePath, targetBinaryPath);
      copyFileSafe(sourceLineagePath, path.join(targetDir, 'migration-lineage.json'));
      prepareManagedResources(targetBinaryPath, targetDir);
    }
    ensureExecutableMode(targetBinaryPath);
    const bundledManagedResourcesDir = path.join(targetDir, 'managed-resources');

    // The release tag is the authoritative version — the aioncore
    // binary does not expose a --version flag (it has --app-version which
    // takes a value, not a self-report).
    const manifest = buildBundleManifest({
      platform,
      arch,
      version: tag || `actions-run-${actionsRunId}`,
      sourceType,
      source: sourceDetail,
    });

    writeJson(path.join(targetDir, 'manifest.json'), manifest);
    verifyPreparedAioncoreBundle(projectRoot, platform, arch);
    console.log(
      `  Bundled aioncore prepared: resources/bundled-aioncore/${runtimeKey}/${binaryName} [source=${sourceType}]`
    );
    console.log(`  Bundled managed resources prepared: ${bundledManagedResourcesDir}`);

    if (tempDir) removeDirectorySafe(tempDir);
    return { prepared: true, dir: targetDir, sourceType };
  }

  throw new Error(`aioncore binary not found for ${runtimeKey} (tag: ${tag})`);
}

module.exports = {
  ACCEPTED_AIONCORE_SOURCE_COMMIT,
  assertAcceptedActionsRun,
  assertHttpsUrl,
  computeSha256,
  cosign,
  getActionsArtifactMissingMessage,
  getActionsArtifactName,
  findCompleteActionsBundleRoot,
  getAioncoreSource,
  getForgeDownloadUrl,
  isIntegrityError,
  isVerificationSkipped,
  makeIntegrityError,
  assertAcceptedMigrationLineageFile,
  buildBundleManifest,
  prepareAioncore,
  resolveForgeSource,
  verifyArchiveDigest,
  verifyCosignSignature,
  verifyPreparedAioncoreBundle,
};
