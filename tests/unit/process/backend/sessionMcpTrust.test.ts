/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISessionMcpServer } from '@/common/config/storage';
import {
  createSessionMcpTrustClaim,
  fingerprintSessionMcpServer,
  installSessionMcpTrustKeyProvider,
  mintSessionMcpTrustClaim,
} from '@process/backend/sessionMcpTrust';
import { describe, expect, it } from 'vitest';

const GOLDEN_KEY = 'QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI';
const GOLDEN_FINGERPRINT = 'f00a0b687dad20ca2e2b0de601979878bda785a7232f0a34e7f9e37b28b0cb07';
const GOLDEN_PAYLOAD =
  'eyJ2ZXJzaW9uIjoxLCJhdWRpZW5jZSI6ImFpb25jb3JlLnNlc3Npb24tbWNwLXRydXN0Iiwic2VydmVyX2lkIjoic3R1ZGlvLXByb2plY3QtMSIsInNlcnZlcl9maW5nZXJwcmludCI6ImYwMGEwYjY4N2RhZDIwY2EyZTJiMGRlNjAxOTc5ODc4YmRhNzg1YTcyMzJmMGEzNGU3ZjllMzdiMjhiMGNiMDciLCJpc3N1ZWRfYXRfbXMiOjE4MDAwMDAwMDAwMDAsImV4cGlyZXNfYXRfbXMiOjE4MDAwMDAxMjAwMDAsIm5vbmNlIjoiQVFFQkFRRUJBUUVCQVFFQkFRRUJBUSJ9';
const GOLDEN_SIGNATURE = '-btA8nf8G_syCrSH2h_0bSRPXFo8NzDDJhbhTKTWOHE';

const goldenServer = (): ISessionMcpServer => ({
  id: 'studio-project-1',
  name: 'aionui-creative-studio',
  transport: {
    type: 'stdio',
    command: 'node',
    args: ['/app/out/main/builtin-mcp-studio.js'],
    env: { STUDIO_PROJECT_ID: 'project-1', UNICODE: 'عکس‌های' },
  },
});

const deterministicClaim = (server: ISessionMcpServer = goldenServer(), key = GOLDEN_KEY) =>
  mintSessionMcpTrustClaim(server, key, {
    now: () => 1_800_000_000_000,
    randomBytes: () => Buffer.alloc(16, 1),
  });

describe('session MCP trust claims', () => {
  it('matches the shared AionCore fingerprint, payload, and HMAC golden vector', () => {
    expect(fingerprintSessionMcpServer(goldenServer())).toBe(GOLDEN_FINGERPRINT);
    expect(deterministicClaim()).toEqual({ payload: GOLDEN_PAYLOAD, signature: GOLDEN_SIGNATURE });
  });

  it('canonicalizes map insertion order but binds every executable identity field', () => {
    const server = goldenServer();
    if (server.transport.type !== 'stdio') throw new Error('invalid test fixture');
    const reordered: ISessionMcpServer = {
      ...server,
      transport: {
        ...server.transport,
        env: { UNICODE: 'عکس‌های', STUDIO_PROJECT_ID: 'project-1' },
      },
    };
    expect(fingerprintSessionMcpServer(reordered)).toBe(GOLDEN_FINGERPRINT);
    expect(deterministicClaim(reordered)).toEqual(deterministicClaim(server));

    const variants: ISessionMcpServer[] = [
      { ...server, id: 'studio-project-2' },
      { ...server, name: 'external-studio' },
      { ...server, transport: { ...server.transport, command: 'bun' } },
      { ...server, transport: { ...server.transport, args: ['/tmp/attacker.js'] } },
      { ...server, transport: { ...server.transport, env: { ...server.transport.env, EXTRA: '1' } } },
      { ...server, transport: { ...server.transport, env: { ...server.transport.env, UNICODE: 'عکسها' } } },
    ];
    for (const variant of variants) expect(fingerprintSessionMcpServer(variant)).not.toBe(GOLDEN_FINGERPRINT);
  });

  it('length-frames and sorts every supported network transport header map', () => {
    const http: ISessionMcpServer = {
      id: 'http-1',
      name: 'remote',
      transport: { type: 'http', url: 'https://example.invalid/mcp', headers: { Zebra: '2', Alpha: '1' } },
    };
    const reordered: ISessionMcpServer = {
      ...http,
      transport: { type: 'http', url: 'https://example.invalid/mcp', headers: { Alpha: '1', Zebra: '2' } },
    };
    expect(fingerprintSessionMcpServer(reordered)).toBe(fingerprintSessionMcpServer(http));
    expect(
      fingerprintSessionMcpServer({
        ...http,
        transport: { type: 'sse', url: 'https://example.invalid/mcp', headers: http.transport.headers },
      })
    ).not.toBe(fingerprintSessionMcpServer(http));
  });

  it('fails closed for a malformed key, clock, or nonce source', () => {
    expect(() => deterministicClaim(goldenServer(), 'not-a-32-byte-key')).toThrow('session_mcp_trust_key_unavailable');
    expect(() =>
      mintSessionMcpTrustClaim(goldenServer(), GOLDEN_KEY, {
        now: () => Number.MAX_SAFE_INTEGER,
        randomBytes: () => Buffer.alloc(16, 1),
      })
    ).toThrow('session_mcp_trust_clock_invalid');
    expect(() =>
      mintSessionMcpTrustClaim(goldenServer(), GOLDEN_KEY, {
        now: () => 1,
        randomBytes: () => Buffer.alloc(15, 1),
      })
    ).toThrow('session_mcp_trust_nonce_invalid');
  });

  it('reads the current Main-only provider for every claim and never embeds the key', () => {
    let key = GOLDEN_KEY;
    const uninstall = installSessionMcpTrustKeyProvider(() => key);
    try {
      const first = createSessionMcpTrustClaim(goldenServer());
      key = Buffer.alloc(32, 3).toString('base64url');
      const second = createSessionMcpTrustClaim(goldenServer());
      expect(second.signature).not.toBe(first.signature);
      expect(Buffer.from(first.payload, 'base64url').toString('utf8')).not.toContain(GOLDEN_KEY);
      expect(goldenServer().transport).not.toHaveProperty('env.AIONUI_SESSION_MCP_TRUST_KEY');
    } finally {
      uninstall();
    }
    expect(() => createSessionMcpTrustClaim(goldenServer())).toThrow('session_mcp_trust_key_unavailable');
  });

  it('fails closed with the named error when the installed provider has no key', () => {
    const uninstall = installSessionMcpTrustKeyProvider(() => undefined as never);
    try {
      expect(() => createSessionMcpTrustClaim(goldenServer())).toThrow('session_mcp_trust_key_unavailable');
    } finally {
      uninstall();
    }
  });
});
