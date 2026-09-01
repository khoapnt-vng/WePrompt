/**
 * Pinned SHA-256 digests for AionCore release artifacts.
 *
 * SECURITY (Forge finding #1): AionUi downloads AionCore release archives and
 * executes the extracted binary. These pinned digests are the trust anchor for
 * that flow — the archive is verified against the digest committed HERE (in our
 * repo) BEFORE it is ever extracted or executed. This defeats MITM tampering,
 * mutable re-tags of the upstream release, and post-vetting release tampering.
 *
 * The digests are NOT anchored on the release-served `aioncore-checksums.txt`
 * (that file is unsigned and lives next to the artifacts, so an attacker who can
 * swap an artifact can swap the checksums file too). We may fetch it as a
 * secondary cross-check when regenerating, but the value below is what we trust.
 *
 * Keyed by AionCore release tag → { assetFileName: sha256Hex }.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO REGENERATE ON A VERSION BUMP
 * ─────────────────────────────────────────────────────────────────────────────
 * When `aioncoreVersion` in the repo-root package.json changes (see the
 * `bump-version` skill, step 5–6), add a new entry to CHECKSUMS below keyed by
 * the new tag. Obtain the digests from the release's checksums file:
 *
 *   curl -fsSL --proto '=https' --proto-redir '=https' \
 *     "https://github.com/iOfficeAI/AionCore/releases/download/<tag>/aioncore-checksums.txt"
 *
 * Then CROSS-VERIFY at least one artifact by downloading it and hashing it
 * locally, confirming the value matches the checksums file before trusting it:
 *
 *   curl -fsSL --proto '=https' --proto-redir '=https' -o /tmp/a.tar.gz \
 *     "https://github.com/iOfficeAI/AionCore/releases/download/<tag>/<asset>"
 *   node -e "const c=require('crypto'),f=require('fs');\
 *     console.log(c.createHash('sha256').update(f.readFileSync('/tmp/a.tar.gz')).digest('hex'))"
 *
 * Only after the local hash matches the checksums file should the values be
 * committed here. Keep old versions in the map so older pins remain reproducible.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * v0.1.43
 * ─────────────────────────────────────────────────────────────────────────────
 * Source: https://github.com/iOfficeAI/AionCore/releases/download/v0.1.43/aioncore-checksums.txt
 * Cross-verified: aioncore-v0.1.43-x86_64-apple-darwin.tar.gz downloaded and
 * hashed with node:crypto — matched the checksums file (30073347 bytes).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * v0.1.50
 * ─────────────────────────────────────────────────────────────────────────────
 * Source: https://github.com/iOfficeAI/AionCore/releases/download/v0.1.50/aioncore-checksums.txt
 * Cross-verified: aioncore-v0.1.50-aarch64-apple-darwin.tar.gz downloaded and
 * hashed with node:crypto — matched the checksums file (30094957 bytes).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * v0.1.51 (security-patched fork: khoapnt-vng/aioncore)
 * ─────────────────────────────────────────────────────────────────────────────
 * Source: https://github.com/khoapnt-vng/aioncore/releases/download/v0.1.51/aioncore-checksums.txt
 * Cross-verified: aioncore-v0.1.51-aarch64-apple-darwin.tar.gz downloaded and
 * hashed with shasum -a 256 — matched the checksums file (31387543 bytes).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * v0.1.55 (internal two-target release: khoapnt-vng/aioncore)
 * ─────────────────────────────────────────────────────────────────────────────
 * Source: https://github.com/khoapnt-vng/aioncore/releases/download/v0.1.55/aioncore-checksums.txt
 * Cross-verified: both published archives were downloaded and independently
 * hashed with shasum -a 256 — both matched the release sidecar.
 */

const CHECKSUMS = {
  'v0.1.55': {
    'aioncore-v0.1.55-aarch64-apple-darwin.tar.gz': 'cde7f6dc21d7f3a6c6a5ee1ef16ffc401976d2b0724f3e07358cdb2f22cead5d',
    'aioncore-v0.1.55-x86_64-pc-windows-msvc.zip': 'bca6cc3988f9f0cdef2a9f1c74c2a5f9b3091fb9920bae0b299f2a20126ee6ef',
  },
  'v0.1.51': {
    'aioncore-v0.1.51-aarch64-apple-darwin.tar.gz': '116069dd12116c77533457b6c913d1509552f672da42e9812a711b4e013194f4',
    'aioncore-v0.1.51-aarch64-pc-windows-msvc.zip': '9b64955ff0e8601e013cc679b02102efae43f59f6ca626a6bf42bf0d3253cfa1',
    'aioncore-v0.1.51-aarch64-unknown-linux-gnu.tar.gz':
      '0be9cb398e4f7701b4dd6f683d235cccc67630509775b8250e8c51ab5d9b5c0e',
    'aioncore-v0.1.51-x86_64-apple-darwin.tar.gz': 'e2796c6e7858c58bb218a937f9fb0248943c16d155717d50d5b6f397f1e3c73c',
    'aioncore-v0.1.51-x86_64-pc-windows-msvc.zip': 'b20ff966850940743fbc83ad6dfb95178ad25612e72cdebd6e47741a18756060',
    'aioncore-v0.1.51-x86_64-unknown-linux-gnu.tar.gz':
      '0a16bc5392565f53710ae096b882133c5a3ad35600d4bac17a99cd362ddb898d',
  },
  'v0.1.50': {
    'aioncore-v0.1.50-aarch64-apple-darwin.tar.gz': '9f37c9d9b5f6e74a69796053be9e52a88dd43a58eee0aa7e042ff334830f8dd5',
    'aioncore-v0.1.50-aarch64-pc-windows-msvc.zip': '327287106a5c4fc5e9ad52148ba598e2d338077d63bde39953e8195da5cecc69',
    'aioncore-v0.1.50-aarch64-unknown-linux-gnu.tar.gz':
      'a1318eb486d7837d2985f4aabaaac646c03001b7e278f9751b5e7fbe225624d0',
    'aioncore-v0.1.50-x86_64-apple-darwin.tar.gz': '3165ab706f1e3c360f671d399198a77a869f0f33fa203251f035dcaf4c329934',
    'aioncore-v0.1.50-x86_64-pc-windows-msvc.zip': '98d02090e743850d037a7dea61dc8b8e60cb7a963a7aa7dd0f81a5e73cbc6835',
    'aioncore-v0.1.50-x86_64-unknown-linux-gnu.tar.gz':
      '381a480b69e307f5f0bfafd4494b45b99341c046b425f0c1daa55a9cea3bf88c',
  },
  'v0.1.43': {
    'aioncore-v0.1.43-aarch64-apple-darwin.tar.gz': '6eab591336bf3a69ef08bdb7262b994617f48dd6d10547e7feda812939c8075f',
    'aioncore-v0.1.43-aarch64-pc-windows-msvc.zip': '473d9e24c7f33cec6580f846bc2c9dd967a88283f1e393f572b5d9630f9e9586',
    'aioncore-v0.1.43-aarch64-unknown-linux-gnu.tar.gz':
      'd8f86dc1538b85f136466c0e9ef011ceb5357276e9beb5a3715673ff1d28594b',
    'aioncore-v0.1.43-x86_64-apple-darwin.tar.gz': '8d857d49a2bf47fc90eee67d2baceb4f9c2d19975fe6f5a4c2ed38f9416b2376',
    'aioncore-v0.1.43-x86_64-pc-windows-msvc.zip': 'c91a2a7be4b72cebbad7291212d1d65518ab5ef7f16eeabc8b7537a162b8bf93',
    'aioncore-v0.1.43-x86_64-unknown-linux-gnu.tar.gz':
      'f198875cf25fc39365db2cb3f6e6921ef6b0adfcbe4664e3ba53239cd0f2e85d',
  },
};

/**
 * Look up the pinned SHA-256 digest for a release asset.
 *
 * @param {string} version - AionCore release tag (e.g. 'v0.1.43').
 * @param {string} assetName - Release asset file name.
 * @returns {string | null} lowercase hex digest, or null when no pin exists.
 */
function getPinnedDigest(version, assetName) {
  const forVersion = CHECKSUMS[version];
  if (!forVersion) return null;
  return forVersion[assetName] || null;
}

module.exports = {
  CHECKSUMS,
  getPinnedDigest,
};
