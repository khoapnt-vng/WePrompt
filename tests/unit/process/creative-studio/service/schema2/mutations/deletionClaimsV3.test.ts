/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import {
  createStudioDeletionClaimCacheV3,
  type StudioProjectDeletionObservationV3,
  type StudioUnreadableProjectDeletionObservationV3,
} from '@/process/services/creative-studio/service/schema2/mutations/deletionClaimsV3';

const unreadable = (
  overrides: Partial<StudioUnreadableProjectDeletionObservationV3> = {}
): StudioUnreadableProjectDeletionObservationV3 => ({
  catalogueId: 'project_1',
  classification: 'unsupported',
  directoryIdentity: { dev: '16777234', ino: '9001' },
  manifestFingerprint: 'a'.repeat(64),
  ...overrides,
});

const tokenFactory = () => {
  let index = 0;
  return () => `studio-delete-v3_${String(++index).padStart(32, 'a')}`;
};

describe('schema-6 opaque deletion claims', () => {
  it('exposes only an opaque expiring token and consumes a matching claim once', () => {
    let now = Date.parse('2026-08-30T00:00:00.000Z');
    const cache = createStudioDeletionClaimCacheV3({ now: () => now, createToken: tokenFactory() });
    const issued = cache.issue(unreadable());
    expect(issued).toEqual({
      deletionClaim: expect.stringMatching(/^studio-delete-v3_/),
      expiresAt: '2026-08-30T00:05:00.000Z',
    });
    expect(JSON.stringify(issued)).not.toContain('16777234');
    expect(JSON.stringify(issued)).not.toContain('9001');
    expect(JSON.stringify(issued)).not.toContain('a'.repeat(64));
    expect(cache.size).toBe(1);

    now += 1;
    expect(() => cache.consume(issued.deletionClaim, unreadable())).not.toThrow();
    expect(cache.size).toBe(0);
    expect(() => cache.consume(issued.deletionClaim, unreadable())).toThrow(
      expect.objectContaining({ code: 'claim_not_found' })
    );
  });

  it('expires claims and refuses their replay', () => {
    let now = 1_000;
    const cache = createStudioDeletionClaimCacheV3({
      now: () => now,
      createToken: tokenFactory(),
      ttlMs: 100,
    });
    const { deletionClaim } = cache.issue(unreadable());
    now = 1_100;
    expect(() => cache.consume(deletionClaim, unreadable())).toThrow(
      expect.objectContaining({ code: 'claim_expired' })
    );
    expect(() => cache.consume(deletionClaim, unreadable())).toThrow(
      expect.objectContaining({ code: 'claim_not_found' })
    );
  });

  it('fails closed if the monotonic claim clock moves behind issue time', () => {
    let now = 1_000;
    const cache = createStudioDeletionClaimCacheV3({ now: () => now, createToken: tokenFactory() });
    const { deletionClaim } = cache.issue(unreadable());
    now = 999;
    expect(() => cache.consume(deletionClaim, unreadable())).toThrow(
      expect.objectContaining({ code: 'claim_expired' })
    );
  });

  it.each([
    ['directory replacement', { ...unreadable(), directoryIdentity: { dev: '16777234', ino: '9002' } }],
    ['manifest change', { ...unreadable(), manifestFingerprint: 'b'.repeat(64) }],
    ['reclassification', { ...unreadable(), classification: 'quarantined' as const }],
    ['healthy transition', { ...unreadable(), classification: 'healthy' as const }],
    [
      'missing transition',
      {
        catalogueId: 'project_1',
        classification: 'missing' as const,
        directoryIdentity: null,
        manifestFingerprint: null,
      },
    ],
  ] satisfies Array<[string, StudioProjectDeletionObservationV3]>)('burns the claim on %s', (_label, current) => {
    const cache = createStudioDeletionClaimCacheV3({ now: () => 1_000, createToken: tokenFactory() });
    const { deletionClaim } = cache.issue(unreadable());
    expect(() => cache.consume(deletionClaim, current)).toThrow(expect.objectContaining({ code: 'claim_mismatch' }));
    expect(() => cache.consume(deletionClaim, unreadable())).toThrow(
      expect.objectContaining({ code: 'claim_not_found' })
    );
  });

  it('fails closed at capacity without evicting existing claims', () => {
    const createToken = tokenFactory();
    const cache = createStudioDeletionClaimCacheV3({
      now: () => 1_000,
      createToken,
      maximumClaims: 2,
    });
    const first = cache.issue(unreadable({ catalogueId: 'project_1' }));
    const second = cache.issue(unreadable({ catalogueId: 'project_2' }));
    expect(() => cache.issue(unreadable({ catalogueId: 'project_3' }))).toThrow(
      expect.objectContaining({ code: 'claim_capacity' })
    );
    expect(cache.size).toBe(2);
    expect(() => cache.consume(first.deletionClaim, unreadable({ catalogueId: 'project_1' }))).not.toThrow();
    expect(() => cache.consume(second.deletionClaim, unreadable({ catalogueId: 'project_2' }))).not.toThrow();
  });

  it('purges expired claims before enforcing capacity', () => {
    let now = 1_000;
    const cache = createStudioDeletionClaimCacheV3({
      now: () => now,
      createToken: tokenFactory(),
      ttlMs: 100,
      maximumClaims: 1,
    });
    const first = cache.issue(unreadable({ catalogueId: 'project_1' }));
    now = 1_100;
    const second = cache.issue(unreadable({ catalogueId: 'project_2' }));
    expect(cache.size).toBe(1);
    expect(() => cache.consume(first.deletionClaim, unreadable({ catalogueId: 'project_1' }))).toThrow(
      expect.objectContaining({ code: 'claim_not_found' })
    );
    expect(() => cache.consume(second.deletionClaim, unreadable({ catalogueId: 'project_2' }))).not.toThrow();
  });

  it('preserves existing claims when token generation cannot produce a valid unique token', () => {
    let candidate = 'studio-delete-v3_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const cache = createStudioDeletionClaimCacheV3({
      now: () => 1_000,
      createToken: () => candidate,
      maximumClaims: 2,
    });
    const first = cache.issue(unreadable({ catalogueId: 'project_1' }));
    candidate = 'not-a-valid-claim';
    expect(() => cache.issue(unreadable({ catalogueId: 'project_2' }))).toThrow(
      expect.objectContaining({ code: 'claim_capacity' })
    );
    expect(cache.size).toBe(1);
    expect(() => cache.consume(first.deletionClaim, unreadable({ catalogueId: 'project_1' }))).not.toThrow();
  });

  it('rejects healthy issuance and observations with extra identity fields', () => {
    const cache = createStudioDeletionClaimCacheV3({ now: () => 1_000, createToken: tokenFactory() });
    expect(() =>
      cache.issue({ ...unreadable(), classification: 'healthy' } as StudioUnreadableProjectDeletionObservationV3)
    ).toThrow(expect.objectContaining({ code: 'invalid_observation' }));
    expect(() =>
      cache.issue({
        ...unreadable(),
        directoryIdentity: { dev: '1', ino: '2', path: '/secret' },
      } as StudioUnreadableProjectDeletionObservationV3)
    ).toThrow(expect.objectContaining({ code: 'invalid_observation' }));
    expect(() => cache.issue(new Proxy(unreadable(), {}))).toThrow(
      expect.objectContaining({ code: 'invalid_observation' })
    );
  });
});
