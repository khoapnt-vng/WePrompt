const { execFileSync } = require('child_process');

/**
 * List refs advertised by a Git publishing remote.
 *
 * @param {string} remoteUrl
 * @returns {string}
 */
function listRemoteRefs(remoteUrl) {
  return execFileSync('git', ['ls-remote', remoteUrl], {
    encoding: 'utf-8',
    timeout: 30000,
  });
}

function isPublishedRef(refName) {
  return refName === 'HEAD' || refName.startsWith('refs/heads/') || refName.startsWith('refs/tags/');
}

/**
 * Assert that a full Git SHA is advertised by a published branch, tag, or HEAD.
 *
 * @param {object} options
 * @param {string} options.sha
 * @param {string} options.remoteUrl
 * @param {(remoteUrl: string) => string} [options.resolveRefs]
 * @returns {void}
 */
function assertGitShaResolvesOnRemote({ sha, remoteUrl, resolveRefs = listRemoteRefs }) {
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`Source commit must be a full 40-character SHA; received ${sha}.`);
  }

  let refs;
  try {
    refs = resolveRefs(remoteUrl);
  } catch (cause) {
    throw new Error(`Publishing host ${remoteUrl} could not be queried; source commit ${sha} is unverified.`, {
      cause,
    });
  }

  if (typeof refs !== 'string') {
    throw new Error(`Publishing host ${remoteUrl} returned no usable ref list; source commit ${sha} is unverified.`);
  }

  const normalizedSha = sha.toLowerCase();
  const resolves = refs.split(/\r?\n/).some((line) => {
    const [objectId, refName] = line.trim().split(/\s+/, 2);
    return (
      typeof objectId === 'string' &&
      typeof refName === 'string' &&
      objectId.toLowerCase() === normalizedSha &&
      isPublishedRef(refName)
    );
  });

  if (!resolves) {
    throw new Error(`Source commit ${sha} does not resolve on publishing host ${remoteUrl}.`);
  }
}

module.exports = {
  assertGitShaResolvesOnRemote,
  listRemoteRefs,
};
