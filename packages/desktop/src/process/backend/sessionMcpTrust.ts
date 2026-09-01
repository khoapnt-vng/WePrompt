/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ISessionMcpServer, ISessionMcpTrustClaim } from '@/common/config/storage';
import { createHash, createHmac, randomBytes as nodeRandomBytes } from 'node:crypto';

const SESSION_MCP_IDENTITY_DOMAIN = Buffer.from('aionui.session-mcp.identity.v1\0', 'ascii');
const SESSION_MCP_TRUST_AUDIENCE = 'aioncore.session-mcp-trust' as const;
const SESSION_MCP_TRUST_TTL_MS = 120_000;
const SESSION_MCP_TRUST_KEY_BYTES = 32;
const SESSION_MCP_TRUST_NONCE_BYTES = 16;
const UNSIGNED_64_MIN = BigInt(0);
const UNSIGNED_64_MAX = BigInt('18446744073709551615');

type SessionMcpTrustPayloadV1 = {
  version: 1;
  audience: typeof SESSION_MCP_TRUST_AUDIENCE;
  server_id: string;
  server_fingerprint: string;
  issued_at_ms: number;
  expires_at_ms: number;
  nonce: string;
};

export type SessionMcpTrustClaimDeps = {
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
};

let trustKeyProvider: (() => string) | null = null;

const framedUnsigned = (value: number | bigint): Buffer => {
  const normalized = typeof value === 'bigint' ? value : BigInt(value);
  if (normalized < UNSIGNED_64_MIN || normalized > UNSIGNED_64_MAX) {
    throw new Error('session_mcp_trust_length_out_of_range');
  }
  const frame = Buffer.allocUnsafe(8);
  frame.writeBigUInt64BE(normalized);
  return frame;
};

const framedString = (value: string): Buffer[] => {
  const bytes = Buffer.from(value, 'utf8');
  return [framedUnsigned(bytes.byteLength), bytes];
};

const sortedEntries = (values: Record<string, string> | undefined): Array<[string, string]> =>
  Object.entries(values ?? {}).toSorted(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)));

/**
 * Hash the exact logical server descriptor authorized by Electron Main.
 * AionCore separately binds this authenticated descriptor to its versioned,
 * Core-owned resolver profile before it may grant runtime trust.
 *
 * Every variable-length field is length framed, including collection counts,
 * so no concatenation ambiguity can produce the same authority fingerprint.
 */
export const fingerprintSessionMcpServer = (server: ISessionMcpServer): string => {
  const chunks: Buffer[] = [SESSION_MCP_IDENTITY_DOMAIN, ...framedString(server.id), ...framedString(server.name)];
  const transport = server.transport;
  chunks.push(...framedString(transport.type));

  if (transport.type === 'stdio') {
    const args = transport.args ?? [];
    const env = sortedEntries(transport.env);
    chunks.push(...framedString(transport.command), framedUnsigned(args.length));
    for (const arg of args) chunks.push(...framedString(arg));
    chunks.push(framedUnsigned(env.length));
    for (const [key, value] of env) chunks.push(...framedString(key), ...framedString(value));
  } else {
    const headers = sortedEntries(transport.headers);
    chunks.push(...framedString(transport.url), framedUnsigned(headers.length));
    for (const [key, value] of headers) chunks.push(...framedString(key), ...framedString(value));
  }

  return createHash('sha256').update(Buffer.concat(chunks)).digest('hex');
};

const decodeTrustKey = (encodedKey: string): Buffer => {
  const key = Buffer.from(encodedKey, 'base64url');
  if (key.byteLength !== SESSION_MCP_TRUST_KEY_BYTES || key.toString('base64url') !== encodedKey) {
    throw new Error('session_mcp_trust_key_unavailable');
  }
  return key;
};

/** Pure claim minter used by Main and deterministic contract tests. */
export const mintSessionMcpTrustClaim = (
  server: ISessionMcpServer,
  encodedKey: string,
  deps: SessionMcpTrustClaimDeps = {}
): ISessionMcpTrustClaim => {
  const issuedAtMs = (deps.now ?? Date.now)();
  if (
    !Number.isSafeInteger(issuedAtMs) ||
    issuedAtMs < 0 ||
    issuedAtMs > Number.MAX_SAFE_INTEGER - SESSION_MCP_TRUST_TTL_MS
  ) {
    throw new Error('session_mcp_trust_clock_invalid');
  }
  const nonceBytes = (deps.randomBytes ?? nodeRandomBytes)(SESSION_MCP_TRUST_NONCE_BYTES);
  if (nonceBytes.byteLength !== SESSION_MCP_TRUST_NONCE_BYTES) {
    throw new Error('session_mcp_trust_nonce_invalid');
  }
  const payloadValue: SessionMcpTrustPayloadV1 = {
    version: 1,
    audience: SESSION_MCP_TRUST_AUDIENCE,
    server_id: server.id,
    server_fingerprint: fingerprintSessionMcpServer(server),
    issued_at_ms: issuedAtMs,
    expires_at_ms: issuedAtMs + SESSION_MCP_TRUST_TTL_MS,
    nonce: nonceBytes.toString('base64url'),
  };
  const payloadBytes = Buffer.from(JSON.stringify(payloadValue), 'utf8');
  const payload = payloadBytes.toString('base64url');
  const signature = createHmac('sha256', decodeTrustKey(encodedKey)).update(payloadBytes).digest('base64url');
  return { payload, signature };
};

/**
 * Install the Main-owned key source. The provider is invoked for every claim,
 * so a backend crash/restart cannot leave the signer using the prior launch's
 * key. This module never exposes the key to its callers.
 */
export const installSessionMcpTrustKeyProvider = (provider: () => string): (() => void) => {
  trustKeyProvider = provider;
  return () => {
    if (trustKeyProvider === provider) trustKeyProvider = null;
  };
};

/** Mint a claim with the currently running backend's Main-only key. */
export const createSessionMcpTrustClaim = (server: ISessionMcpServer): ISessionMcpTrustClaim => {
  if (trustKeyProvider === null) throw new Error('session_mcp_trust_key_unavailable');
  const encodedKey = trustKeyProvider();
  if (typeof encodedKey !== 'string') throw new Error('session_mcp_trust_key_unavailable');
  return mintSessionMcpTrustClaim(server, encodedKey);
};
