import { describe, expect, it } from 'vitest';

const { assertGitShaResolvesOnRemote } = require('../../../packages/shared-scripts/src/verify-git-source-commit');

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
    ).toThrow(/full 40-character SHA/);
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
