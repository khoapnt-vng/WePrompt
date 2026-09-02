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

function assertFullGitObjectId(value, label) {
  if (!/^[0-9a-f]{40}$/i.test(value)) {
    throw new Error(`${label} must be a full 40-character Git object id; received ${value}.`);
  }
}

function findRemoteRefObjectId(refs, refName) {
  const line = refs.split(/\r?\n/).find((candidate) => {
    const [, advertisedRef] = candidate.trim().split(/\s+/, 2);
    return advertisedRef === refName;
  });
  return line?.trim().split(/\s+/, 1)[0]?.toLowerCase();
}

/**
 * Assert the exact annotated-tag object and its peeled source commit.
 *
 * A source-commit pin alone does not detect deleting and recreating an
 * annotated tag at the same commit. The tag object is a separate Git object
 * containing the tagger, timestamp, and message, so pinning both identities
 * makes that release boundary observable.
 *
 * @param {object} options
 * @param {string} options.tagName
 * @param {string} options.tagObjectSha
 * @param {string} options.peeledCommitSha
 * @param {string} options.remoteUrl
 * @param {(remoteUrl: string) => string} [options.resolveRefs]
 * @returns {void}
 */
function assertAnnotatedTagIdentity({
  tagName,
  tagObjectSha,
  peeledCommitSha,
  remoteUrl,
  resolveRefs = listRemoteRefs,
}) {
  assertFullGitObjectId(tagObjectSha, 'Annotated tag object');
  assertFullGitObjectId(peeledCommitSha, 'Peeled tag commit');

  let refs;
  try {
    refs = resolveRefs(remoteUrl);
  } catch (cause) {
    throw new Error(`Publishing host ${remoteUrl} could not be queried; tag ${tagName} is unverified.`, { cause });
  }
  if (typeof refs !== 'string') {
    throw new Error(`Publishing host ${remoteUrl} returned no usable ref list; tag ${tagName} is unverified.`);
  }

  const tagRef = `refs/tags/${tagName}`;
  const advertisedTagObject = findRemoteRefObjectId(refs, tagRef);
  const advertisedCommit = findRemoteRefObjectId(refs, `${tagRef}^{}`);
  if (advertisedTagObject !== tagObjectSha.toLowerCase()) {
    throw new Error(
      `Annotated tag ${tagName} object changed on publishing host ${remoteUrl}; expected ${tagObjectSha}, received ${advertisedTagObject ?? 'missing'}.`
    );
  }
  if (advertisedCommit !== peeledCommitSha.toLowerCase()) {
    throw new Error(
      `Annotated tag ${tagName} peeled commit changed on publishing host ${remoteUrl}; expected ${peeledCommitSha}, received ${advertisedCommit ?? 'missing'}.`
    );
  }
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
  assertFullGitObjectId(sha, 'Source commit');

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
  assertAnnotatedTagIdentity,
  assertGitShaResolvesOnRemote,
  listRemoteRefs,
};
