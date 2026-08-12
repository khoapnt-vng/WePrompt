/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  BUILTIN_HTTP_MCP_SERVERS,
  GREENNODE_BASE_URL,
  GREENNODE_MODELS,
  GREENNODE_OPENCODE_DEFAULT_MODEL,
  GREENNODE_OPENCODE_PROVIDER_ID,
} from '@/common/config/builtinSeed';
import { BUILTIN_TAVILY_NAME } from '@/common/config/builtinCapabilities';
import type { IHubAgentItem } from '@/common/types/agent/hub';
import type { IMcpServer } from '@/common/config/storage';
import {
  buildBuiltinHttpMcpServers,
  buildTavilyCredentialUpdate,
  findOpenCodeHubExtension,
  hasSeededTavilyCredential,
  mergeGreenNodeIntoOpenCodeConfig,
  mergeMoonshotIntoOpenCodeConfig,
  mergeVisionMcpIntoOpenCodeConfig,
  type OpenCodeConfig,
} from './seedBuiltinProviders';

describe('mergeGreenNodeIntoOpenCodeConfig', () => {
  it('seeds an empty config with provider, both models, and default model', () => {
    const config: OpenCodeConfig = {};
    const changed = mergeGreenNodeIntoOpenCodeConfig(config);

    expect(changed).toBe(true);
    const provider = config.provider?.[GREENNODE_OPENCODE_PROVIDER_ID];
    expect(provider?.npm).toBe('@ai-sdk/openai-compatible');
    expect(provider?.options?.baseURL).toBe(GREENNODE_BASE_URL);
    expect(Object.keys(provider?.models ?? {})).toEqual([...GREENNODE_MODELS]);
    expect(config.model).toBe(GREENNODE_OPENCODE_DEFAULT_MODEL);
  });

  it('keeps existing user values and only fills gaps', () => {
    const config: OpenCodeConfig = {
      model: 'anthropic/claude-sonnet',
      shell: 'sh',
      provider: {
        [GREENNODE_OPENCODE_PROVIDER_ID]: {
          name: 'My Custom Name',
          options: { baseURL: 'https://my-proxy.example.com/v1' },
          models: { 'minimax/minimax-m2.5': { name: 'Custom Label' } },
        },
      },
    };
    const changed = mergeGreenNodeIntoOpenCodeConfig(config);

    expect(changed).toBe(true); // npm field + gpt-5 model were missing
    const provider = config.provider?.[GREENNODE_OPENCODE_PROVIDER_ID];
    expect(config.model).toBe('anthropic/claude-sonnet');
    expect(config.shell).toBe('sh');
    expect(provider?.name).toBe('My Custom Name');
    expect(provider?.options?.baseURL).toBe('https://my-proxy.example.com/v1');
    expect(provider?.models?.['minimax/minimax-m2.5']?.name).toBe('Custom Label');
    expect(provider?.models?.['openai/gpt-5']).toBeDefined();
  });

  it('is idempotent — a second merge reports no changes', () => {
    const config: OpenCodeConfig = {};
    mergeGreenNodeIntoOpenCodeConfig(config);
    const changedAgain = mergeGreenNodeIntoOpenCodeConfig(config);

    expect(changedAgain).toBe(false);
  });
});

describe('mergeMoonshotIntoOpenCodeConfig', () => {
  it('adds the moonshot provider and models without touching config.model', () => {
    const config: OpenCodeConfig = {
      provider: { vngcloud: { name: 'GreenNode' } },
      model: 'vngcloud/minimax/minimax-m2.5',
    };
    const changed = mergeMoonshotIntoOpenCodeConfig(config);

    expect(changed).toBe(true);
    expect(config.provider!.moonshot.npm).toBe('@ai-sdk/openai-compatible');
    expect(config.provider!.moonshot.options!.baseURL).toBe('https://api.moonshot.ai/v1');
    expect(Object.keys(config.provider!.moonshot.models!)).toEqual(['kimi-k2.6', 'kimi-k2.5']);
    expect(config.provider!.vngcloud).toBeDefined(); // existing provider preserved
    expect(config.model).toBe('vngcloud/minimax/minimax-m2.5'); // unchanged
  });
});

describe('mergeVisionMcpIntoOpenCodeConfig', () => {
  it('adds the image-analysis MCP entry to an empty config', () => {
    const config: OpenCodeConfig = {};
    const changed = mergeVisionMcpIntoOpenCodeConfig(config, '/abs/vision.js', 'key-1');

    expect(changed).toBe(true);
    const entry = config.mcp?.['image-analysis'];
    expect(entry?.type).toBe('local');
    expect(entry?.command).toEqual(['node', '/abs/vision.js']);
    expect(entry?.environment?.AIONUI_VISION_API_KEY).toBe('key-1');
    expect(entry?.environment?.AIONUI_VISION_MODEL).toBeDefined();
    expect(entry?.enabled).toBe(true);
  });

  it('is non-destructive — preserves other mcp entries and skips an existing image-analysis entry', () => {
    const existingEntry = { type: 'local', command: ['node', '/other.js'], enabled: false };
    const config: OpenCodeConfig = {
      mcp: {
        other: { type: 'local', command: ['node', '/other-tool.js'] },
        'image-analysis': existingEntry,
      },
    };
    const changed = mergeVisionMcpIntoOpenCodeConfig(config, '/abs/vision.js', 'key-1');

    expect(changed).toBe(false);
    expect(config.mcp!.other).toEqual({ type: 'local', command: ['node', '/other-tool.js'] });
    expect(config.mcp!['image-analysis']).toBe(existingEntry);
  });
});

const hubItem = (overrides: Partial<IHubAgentItem>): IHubAgentItem =>
  ({
    name: 'ext-something',
    display_name: 'Something',
    description: '',
    author: '',
    dist: { tarball: '', integrity: '', unpackedSize: 0 },
    engines: { aionui: '0.0.0' },
    hubs: ['acpAdapters'],
    status: 'not_installed',
    ...overrides,
  }) as IHubAgentItem;

describe('findOpenCodeHubExtension', () => {
  it('matches an extension by name regardless of prefix or case', () => {
    const extensions = [hubItem({ name: 'ext-claude-code' }), hubItem({ name: 'ext-OpenCode' })];
    expect(findOpenCodeHubExtension(extensions)?.name).toBe('ext-OpenCode');
  });

  it('matches an extension by contributed acp adapter id', () => {
    const extensions = [
      hubItem({ name: 'ext-claude-code' }),
      hubItem({ name: 'ext-sst-agent', contributes: { acpAdapters: ['opencode'] } }),
    ];
    expect(findOpenCodeHubExtension(extensions)?.name).toBe('ext-sst-agent');
  });

  it('returns undefined when no extension matches', () => {
    expect(findOpenCodeHubExtension([hubItem({ name: 'ext-codex' })])).toBeUndefined();
    expect(findOpenCodeHubExtension([])).toBeUndefined();
  });
});

describe('buildBuiltinHttpMcpServers', () => {
  it('builds one enabled builtin http server per seed entry', () => {
    const servers = buildBuiltinHttpMcpServers();

    expect(servers.map((server) => server.name)).toEqual(BUILTIN_HTTP_MCP_SERVERS.map((seed) => seed.name));
    for (const [index, server] of servers.entries()) {
      const seed = BUILTIN_HTTP_MCP_SERVERS[index];
      expect(server.enabled).toBe(true);
      expect(server.builtin).toBe(true);
      expect(server.description).toBe(seed.description);
      expect(server.transport).toEqual({ type: 'http', url: seed.url });
    }
  });

  it('emits original_json that round-trips to the transport config', () => {
    for (const server of buildBuiltinHttpMcpServers()) {
      const parsed = JSON.parse(server.original_json ?? '') as {
        mcpServers: Record<string, { type: string; url: string }>;
      };
      expect(parsed.mcpServers[server.name]).toEqual({
        type: 'http',
        url: server.transport.type === 'http' ? server.transport.url : '',
      });
    }
  });

  it('ships no default HTTP MCP servers (removed per WP #24096)', () => {
    expect(BUILTIN_HTTP_MCP_SERVERS).toEqual([]);
    expect(buildBuiltinHttpMcpServers()).toEqual([]);
  });
});

const webSearchServer = (transport: IMcpServer['transport'], overrides: Partial<IMcpServer> = {}): IMcpServer =>
  ({
    id: 'builtin-tavily',
    name: BUILTIN_TAVILY_NAME,
    description: 'Web search powered by Tavily. Requires a Tavily API key.',
    enabled: false,
    builtin: true,
    transport,
    ...overrides,
  }) as IMcpServer;

describe('buildTavilyCredentialUpdate', () => {
  const stdioTransport = () => ({
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', 'tavily-mcp@latest'],
    env: {},
  });

  it('applies the key to TAVILY_API_KEY and regenerates original_json', () => {
    const update = buildTavilyCredentialUpdate(webSearchServer(stdioTransport()), 'tvly-test-key');

    expect(update).not.toBeNull();
    expect(update!.transport.env?.TAVILY_API_KEY).toBe('tvly-test-key');
    const parsed = JSON.parse(update!.original_json) as {
      mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
    };
    expect(parsed.mcpServers[BUILTIN_TAVILY_NAME].env?.TAVILY_API_KEY).toBe('tvly-test-key');
    expect(parsed.mcpServers[BUILTIN_TAVILY_NAME].command).toBe('npx');
  });

  it('returns null when the user already configured a credential', () => {
    const transport = { ...stdioTransport(), env: { TAVILY_API_KEY: 'user-own-key' } };
    expect(buildTavilyCredentialUpdate(webSearchServer(transport), 'tvly-test-key')).toBeNull();
  });

  it('returns null when the transport is not stdio (user rewired the server)', () => {
    const httpTransport = { type: 'http' as const, url: 'https://example.com/mcp' };
    expect(buildTavilyCredentialUpdate(webSearchServer(httpTransport), 'tvly-test-key')).toBeNull();
  });
});

describe('hasSeededTavilyCredential', () => {
  const stdioWithKey = (key: string) => ({
    type: 'stdio' as const,
    command: 'npx',
    args: ['-y', 'tavily-mcp@latest'],
    env: { TAVILY_API_KEY: key },
  });

  it('is true when the stored credential equals the build-time key', () => {
    expect(hasSeededTavilyCredential(webSearchServer(stdioWithKey('tvly-shared')), 'tvly-shared')).toBe(true);
  });

  it('is false for a foreign (user-configured) credential', () => {
    expect(hasSeededTavilyCredential(webSearchServer(stdioWithKey('user-own-key')), 'tvly-shared')).toBe(false);
  });

  it('is false when the transport is not stdio', () => {
    const httpTransport = { type: 'http' as const, url: 'https://example.com/mcp' };
    expect(hasSeededTavilyCredential(webSearchServer(httpTransport), 'tvly-shared')).toBe(false);
  });
});
