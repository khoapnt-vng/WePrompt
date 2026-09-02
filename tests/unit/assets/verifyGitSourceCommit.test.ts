import { describe, expect, it } from 'vitest';

const {
  assertAnnotatedTagIdentity,
  assertGitShaResolvesOnRemote,
} = require('../../../packages/shared-scripts/src/verify-git-source-commit');

const publishingRemote = 'https://github.com/khoapnt-vng/aioncore.git';
const verifiedCommit = 'ef6e1dd199e884fdf2df95d494b2c51b97006656';
const fabricatedCommit = '260dbbc05d5c8d079fb60e0e9578d4250b6e4338';

describe('publishing-host Git commit verification', () => {
  it('rejects a SHA that appears only in a ref name', () => {
    const refs = `${fabricatedCommit}\trefs/tags/build-for-${verifiedCommit}\n`;

    expect(() =>
      assertGitShaResolvesOnRemote({
        sha: verifiedCommit,
        remoteUrl: publishingRemote,
        resolveRefs: () => refs,
      })
    ).toThrow(/does not resolve on publishing host/);
  });

  it('rejects abbreviated SHA input even when it prefixes an advertised commit', () => {
    const refs = `${verifiedCommit}\trefs/heads/main\n`;

    expect(() =>
      assertGitShaResolvesOnRemote({
        sha: verifiedCommit.slice(0, 12),
        remoteUrl: publishingRemote,
        resolveRefs: () => refs,
      })
    ).toThrow(/full 40-character Git object id/);
  });

  it('rejects a commit advertised only by a pull-request ref', () => {
    const refs = `${verifiedCommit}\trefs/pull/79/head\n`;

    expect(() =>
      assertGitShaResolvesOnRemote({
        sha: verifiedCommit,
        remoteUrl: publishingRemote,
        resolveRefs: () => refs,
      })
    ).toThrow(/does not resolve on publishing host/);
  });

  it('reports an unreachable publishing host as unverified', () => {
    expect(() =>
      assertGitShaResolvesOnRemote({
        sha: verifiedCommit,
        remoteUrl: publishingRemote,
        resolveRefs: () => {
          throw new Error('offline');
        },
      })
    ).toThrow(/publishing host.*could not be queried.*unverified/i);
  });
});

describe('publishing-host annotated tag verification', () => {
  const tagName = 'v0.1.55';
  const tagObjectSha = 'e2aa0db0f1129c6cf5e6b9856ffafaa60c66491b';
  const peeledCommitSha = verifiedCommit;
  const exactRefs = `${tagObjectSha}\trefs/tags/${tagName}\n${peeledCommitSha}\trefs/tags/${tagName}^{}\n`;

  it('accepts the exact annotated tag object and peeled source commit', () => {
    expect(() =>
      assertAnnotatedTagIdentity({
        tagName,
        tagObjectSha,
        peeledCommitSha,
        remoteUrl: publishingRemote,
        resolveRefs: () => exactRefs,
      })
    ).not.toThrow();
  });

  it('rejects a recreated tag object even when it peels to the accepted commit', () => {
    const recreatedTag = `1111111111111111111111111111111111111111\trefs/tags/${tagName}\n${peeledCommitSha}\trefs/tags/${tagName}^{}\n`;

    expect(() =>
      assertAnnotatedTagIdentity({
        tagName,
        tagObjectSha,
        peeledCommitSha,
        remoteUrl: publishingRemote,
        resolveRefs: () => recreatedTag,
      })
    ).toThrow(/tag .* object changed/);
  });

  it('rejects a moved tag whose peeled source commit changed', () => {
    const movedTag = `${tagObjectSha}\trefs/tags/${tagName}\n2222222222222222222222222222222222222222\trefs/tags/${tagName}^{}\n`;

    expect(() =>
      assertAnnotatedTagIdentity({
        tagName,
        tagObjectSha,
        peeledCommitSha,
        remoteUrl: publishingRemote,
        resolveRefs: () => movedTag,
      })
    ).toThrow(/peeled commit changed/);
  });

  it('rejects a lightweight tag without an independent annotated object', () => {
    const lightweightTag = `${peeledCommitSha}\trefs/tags/${tagName}\n`;

    expect(() =>
      assertAnnotatedTagIdentity({
        tagName,
        tagObjectSha,
        peeledCommitSha,
        remoteUrl: publishingRemote,
        resolveRefs: () => lightweightTag,
      })
    ).toThrow(/tag .* object changed/);
  });
});
